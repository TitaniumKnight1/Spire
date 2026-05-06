import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { app, protocol } from "electron";
import { appendMediaPlaybackDebugLine } from "./mediaPlaybackDebugLog.js";

export const MEDIA_SCHEME = "spire-media";
export const MEDIA_HOST = "local";

function contentTypeForAudioPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
    case ".m4b":
      return "audio/mp4";
    case ".aac":
      return "audio/aac";
    case ".ogg":
      return "audio/ogg";
    case ".flac":
      return "audio/flac";
    case ".wav":
      return "audio/wav";
    case ".opus":
      return "audio/ogg; codecs=opus";
    default:
      return "application/octet-stream";
  }
}

function baseHeaders(resolvedPath: string): Headers {
  const h = new Headers();
  h.set("Content-Type", contentTypeForAudioPath(resolvedPath));
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Range");
  h.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
  h.set("Accept-Ranges", "bytes");
  return h;
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function summarizeRequest(request: Request): Record<string, unknown> {
  const h = request.headers;
  return {
    method: request.method,
    url: request.url,
    urlLength: request.url.length,
    mode: request.mode,
    destination: request.destination,
    referrer: request.referrer || null,
    cache: request.cache,
    credentials: request.credentials,
    integrity: request.integrity || null,
    redirect: request.redirect,
    range: h.get("range"),
    origin: h.get("origin"),
    referer: h.get("referer"),
    userAgent: h.get("user-agent"),
    accept: h.get("accept"),
    secFetchMode: h.get("sec-fetch-mode"),
    secFetchDest: h.get("sec-fetch-dest"),
    headerKeys: [...h.keys()],
    signalAborted: request.signal.aborted,
  };
}

/** Parse first `bytes=` range; returns inclusive start/end or null if not satisfiable / invalid. */
function parseRangeHeader(rangeHeader: string | undefined, fileSize: number): { start: number; end: number } | null {
  if (!rangeHeader?.startsWith("bytes=")) {
    return null;
  }
  const spec = rangeHeader.slice("bytes=".length).trim();
  const rangeSpec = spec.split(",")[0]?.trim() ?? "";
  const dash = rangeSpec.indexOf("-");
  if (dash < 0) {
    return null;
  }
  const startStr = rangeSpec.slice(0, dash);
  const endStr = rangeSpec.slice(dash + 1);

  let start: number;
  let end: number;

  if (startStr === "" && endStr !== "") {
    const suffixLen = parseInt(endStr, 10);
    if (Number.isNaN(suffixLen) || suffixLen <= 0) {
      return null;
    }
    start = Math.max(0, fileSize - suffixLen);
    end = fileSize - 1;
  } else if (startStr !== "" && endStr === "") {
    start = parseInt(startStr, 10);
    if (Number.isNaN(start) || start < 0 || start >= fileSize) {
      return null;
    }
    end = fileSize - 1;
  } else if (startStr !== "" && endStr !== "") {
    start = parseInt(startStr, 10);
    end = parseInt(endStr, 10);
    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start > end || start >= fileSize) {
      return null;
    }
    end = Math.min(end, fileSize - 1);
    if (start > end) {
      return null;
    }
  } else {
    return null;
  }

  return { start, end };
}

function attachAbortDestroy(signal: AbortSignal, stream: fs.ReadStream, reqId: string, resolvedPath: string): void {
  const onAbort = (): void => {
    appendMediaPlaybackDebugLine("media.protocol.stream.abort", { reqId, resolvedPath });
    stream.destroy();
  };
  if (signal.aborted) {
    appendMediaPlaybackDebugLine("media.protocol.signal.already_aborted", { reqId, resolvedPath });
    stream.destroy();
    return;
  }
  signal.addEventListener("abort", onAbort, { once: true });
  stream.once("close", () => {
    signal.removeEventListener("abort", onAbort);
  });
}

function attachStreamDiagnostics(stream: fs.ReadStream, reqId: string, context: Record<string, unknown>): void {
  stream.once("open", (fd) => {
    appendMediaPlaybackDebugLine("media.protocol.stream.open", { reqId, fd, ...context });
  });
  stream.on("error", (err) => {
    const e = err as NodeJS.ErrnoException;
    appendMediaPlaybackDebugLine(
      "media.protocol.stream.error",
      {
        reqId,
        message: e.message,
        code: e.code,
        syscall: e.syscall,
        ...context,
      },
      { mirrorConsole: true },
    );
  });
  stream.once("end", () => {
    appendMediaPlaybackDebugLine("media.protocol.stream.end", { reqId, ...context });
  });
  stream.once("close", () => {
    appendMediaPlaybackDebugLine("media.protocol.stream.close", { reqId, ...context });
  });
}

/**
 * Serve library audio with explicit byte streams.
 * `net.fetch(file://...)` through `protocol.handle` is unreliable for Chromium's FFmpeg
 * demuxer (often `DEMUXER_ERROR_COULD_NOT_OPEN`); ranged `fs` reads match the working
 * `audio-server` pattern.
 */
async function respondWithLibraryFile(request: Request, resolvedPath: string, reqId: string): Promise<Response> {
  const method = request.method;
  if (method !== "GET" && method !== "HEAD") {
    appendMediaPlaybackDebugLine("media.protocol.respond.method_not_allowed", { reqId, method, resolvedPath });
    return new Response("Method Not Allowed", { status: 405 });
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(resolvedPath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    appendMediaPlaybackDebugLine(
      "media.protocol.stat_failed",
      { reqId, resolvedPath, code: e.code, message: e.message },
      { mirrorConsole: true },
    );
    return new Response("Not Found", { status: 404 });
  }

  if (!stat.isFile()) {
    appendMediaPlaybackDebugLine("media.protocol.not_a_file", {
      reqId,
      resolvedPath,
      isDirectory: stat.isDirectory(),
      isBlockDevice: stat.isBlockDevice?.() ?? null,
    });
    return new Response("Not Found", { status: 404 });
  }

  const fileSize = stat.size;
  const rangeHeader = request.headers.get("range") ?? undefined;

  appendMediaPlaybackDebugLine("media.protocol.file_stat", {
    reqId,
    resolvedPath,
    fileSize,
    rangeHeader: rangeHeader ?? null,
    mtimeMs: stat.mtimeMs,
    mode: stat.mode,
  });

  if (!rangeHeader) {
    const headers = baseHeaders(resolvedPath);
    headers.set("Content-Length", String(fileSize));
    appendMediaPlaybackDebugLine("media.protocol.respond.200", {
      reqId,
      resolvedPath,
      fileSize,
      responseHeaders: headersToObject(headers),
    });
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    const stream = fs.createReadStream(resolvedPath);
    attachStreamDiagnostics(stream, reqId, { resolvedPath, branch: "200_full", start: null, end: null });
    attachAbortDestroy(request.signal, stream, reqId, resolvedPath);
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    return new Response(body, { status: 200, headers });
  }

  const parsed = parseRangeHeader(rangeHeader, fileSize);
  if (parsed === null) {
    const headers416 = baseHeaders(resolvedPath);
    headers416.set("Content-Range", `bytes */${fileSize}`);
    appendMediaPlaybackDebugLine("media.protocol.respond.416", {
      reqId,
      resolvedPath,
      fileSize,
      rangeHeader,
      responseHeaders: headersToObject(headers416),
    });
    return new Response(null, { status: 416, headers: headers416 });
  }

  const { start, end } = parsed;
  const chunkSize = end - start + 1;
  const headers = baseHeaders(resolvedPath);
  headers.set("Content-Range", `bytes ${start}-${end}/${fileSize}`);
  headers.set("Content-Length", String(chunkSize));

  appendMediaPlaybackDebugLine("media.protocol.respond.206", {
    reqId,
    resolvedPath,
    fileSize,
    start,
    end,
    chunkSize,
    rangeHeader,
    responseHeaders: headersToObject(headers),
  });

  if (method === "HEAD") {
    return new Response(null, { status: 206, headers });
  }

  const stream = fs.createReadStream(resolvedPath, { start, end });
  attachStreamDiagnostics(stream, reqId, { resolvedPath, branch: "206_range", start, end, chunkSize });
  attachAbortDestroy(request.signal, stream, reqId, resolvedPath);
  const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
  return new Response(body, { status: 206, headers });
}

let mediaSchemeRegistered = false;

export function registerMediaScheme(): void {
  if (app.isReady()) {
    throw new Error("registerMediaScheme() must be called before app.whenReady() resolves.");
  }
  if (mediaSchemeRegistered) {
    return;
  }

  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        bypassCSP: false,
      },
    },
  ]);
  mediaSchemeRegistered = true;
}

export function handleMediaProtocol(libraryBasePath: string): void {
  const resolvedLibraryBase = path.resolve(libraryBasePath);
  const normalizedLibraryBase =
    resolvedLibraryBase.endsWith(path.sep) ? resolvedLibraryBase : `${resolvedLibraryBase}${path.sep}`;

  void app.whenReady().then(() => {
    appendMediaPlaybackDebugLine("media.protocol.registered", {
      resolvedLibraryBase,
      normalizedLibraryBase,
    });
    protocol.handle(MEDIA_SCHEME, async (request) => {
      const reqId = randomUUID();
      appendMediaPlaybackDebugLine("media.protocol.request", { reqId, ...summarizeRequest(request) });
      try {
        if (request.method === "OPTIONS") {
          appendMediaPlaybackDebugLine("media.protocol.respond.options", { reqId });
          return new Response(null, {
            status: 204,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
              "Access-Control-Allow-Headers": "Range",
            },
          });
        }

        let requestUrl: URL;
        try {
          requestUrl = new URL(request.url);
        } catch (err) {
          appendMediaPlaybackDebugLine(
            "media.protocol.bad_url",
            { reqId, rawUrl: request.url, err: err instanceof Error ? err.message : String(err) },
            { mirrorConsole: true },
          );
          return new Response("Bad Request", { status: 400 });
        }

        if (requestUrl.hostname !== MEDIA_HOST) {
          appendMediaPlaybackDebugLine("media.protocol.wrong_host", {
            reqId,
            hostname: requestUrl.hostname,
            expected: MEDIA_HOST,
          });
          return new Response("Not Found", { status: 404 });
        }

        const rawPathname = requestUrl.pathname;
        const decodedPath = decodeURIComponent(rawPathname.slice(1));
        const resolvedPath = path.resolve(decodedPath);
        const isInsideLibrary =
          resolvedPath === resolvedLibraryBase || resolvedPath.startsWith(normalizedLibraryBase);

        appendMediaPlaybackDebugLine("media.protocol.path_resolution", {
          reqId,
          rawPathname,
          pathnameLen: rawPathname.length,
          decodedPath,
          decodedLen: decodedPath.length,
          resolvedPath,
          resolvedLen: resolvedPath.length,
          resolvedLibraryBase,
          normalizedLibraryBase,
          isInsideLibrary,
        });

        if (!isInsideLibrary) {
          appendMediaPlaybackDebugLine("media.protocol.forbidden", { reqId, resolvedPath }, { mirrorConsole: true });
          return new Response("Forbidden", { status: 403 });
        }

        try {
          await fs.promises.access(resolvedPath, fs.constants.R_OK);
        } catch (err) {
          const e = err as NodeJS.ErrnoException;
          appendMediaPlaybackDebugLine(
            "media.protocol.access_denied",
            { reqId, resolvedPath, code: e.code, message: e.message },
            { mirrorConsole: true },
          );
          return new Response("Not Found", { status: 404 });
        }

        const response = await respondWithLibraryFile(request, resolvedPath, reqId);
        appendMediaPlaybackDebugLine("media.protocol.response", {
          reqId,
          status: response.status,
          statusText: response.statusText,
          responseType: response.type,
          responseHeaders: headersToObject(response.headers),
        });
        return response;
      } catch (error) {
        const fsError = error as NodeJS.ErrnoException;
        if (fsError?.code === "ENOENT") {
          appendMediaPlaybackDebugLine("media.protocol.handler.enoent", { reqId });
          return new Response("Not Found", { status: 404 });
        }
        appendMediaPlaybackDebugLine(
          "media.protocol.handler.error",
          {
            reqId,
            name: error instanceof Error ? error.name : typeof error,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : null,
            code: fsError?.code,
          },
          { mirrorConsole: true },
        );
        console.error("[spire-media] protocol handler error:", error);
        return new Response("Internal Error", { status: 500 });
      }
    });
  });
}

export function resolveToMediaUrl(absolutePath: string): string {
  return `${MEDIA_SCHEME}://${MEDIA_HOST}/${encodeURIComponent(absolutePath)}`;
}
