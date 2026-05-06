import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";

let _port: number | null = null;

export function getAudioServerPort(): number {
  if (_port === null) {
    throw new Error("Audio server not started");
  }
  return _port;
}

/** Public `http://127.0.0.1` URL for a cover file under the covers directory (path validated on the server). */
export function coverHttpUrl(absolutePath: string | null): string | null {
  if (!absolutePath) {
    return null;
  }
  const port = getAudioServerPort();
  const resolved = path.resolve(absolutePath);
  return `http://127.0.0.1:${port}/cover?path=${encodeURIComponent(resolved)}`;
}

/**
 * Library audio over the local HTTP server (same ranged `fs` pipe as `/cover`).
 * Chromium's FFmpeg pipeline does not reliably demux `spire-media://` responses whose body is a
 * web `ReadableStream` from `Readable.toWeb`, even when headers and byte ranges are correct.
 */
export function libraryAudioHttpUrl(absolutePath: string): string {
  const port = getAudioServerPort();
  const resolved = path.resolve(absolutePath);
  return `http://127.0.0.1:${port}/audio?path=${encodeURIComponent(resolved)}`;
}

export interface AudioServer {
  port: number;
  close: () => void;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
} as const;

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

function contentTypeForImagePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

function isPathUnderRoot(resolvedFile: string, root: string): boolean {
  try {
    const r = fs.realpathSync(path.resolve(root));
    const resolved = fs.realpathSync(path.resolve(resolvedFile));
    const rel = path.relative(r, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return false;
    }
    return true;
  } catch {
    const r = path.resolve(root);
    const resolved = path.resolve(resolvedFile);
    const rel = path.relative(r, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return false;
    }
    return true;
  }
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

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }
  return Array.isArray(value) ? value[0] : value;
}

function pipeReadStream(stream: fs.ReadStream, res: http.ServerResponse): void {
  stream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(500, { ...corsHeaders }).end();
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}

function respondWithRangedFile(
  res: http.ServerResponse,
  resolvedFile: string,
  contentType: string,
  rangeHeader: string | undefined,
  method: "GET" | "HEAD",
): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolvedFile);
  } catch {
    res.writeHead(404, { ...corsHeaders }).end();
    return;
  }

  if (!stat.isFile()) {
    res.writeHead(404, { ...corsHeaders }).end();
    return;
  }

  const fileSize = stat.size;

  if (!rangeHeader) {
    res.writeHead(200, {
      ...corsHeaders,
      "Content-Type": contentType,
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
    });
    if (method === "HEAD") {
      res.end();
      return;
    }
    pipeReadStream(fs.createReadStream(resolvedFile), res);
    return;
  }

  const parsed = parseRangeHeader(rangeHeader, fileSize);
  if (parsed === null) {
    res.writeHead(416, {
      ...corsHeaders,
      "Content-Range": `bytes */${fileSize}`,
    });
    res.end();
    return;
  }

  const { start, end } = parsed;
  const chunkSize = end - start + 1;
  res.writeHead(206, {
    ...corsHeaders,
    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
    "Accept-Ranges": "bytes",
    "Content-Length": String(chunkSize),
    "Content-Type": contentType,
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  pipeReadStream(fs.createReadStream(resolvedFile, { start, end }), res);
}

export async function startAudioServer(libraryDir: string, coversDir: string): Promise<AudioServer> {
  const libraryRoot = path.resolve(libraryDir);
  const coversRoot = path.resolve(coversDir);

  const server = http.createServer((req, res) => {
    const reqStart = Date.now();
    res.on("finish", () => {
      console.log(`[spire] audio-server ${req.method} ${req.url?.split("?")[0]} -> ${res.statusCode} (${Date.now() - reqStart}ms)`);
    });

    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          ...corsHeaders,
        });
        res.end();
        return;
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { ...corsHeaders }).end();
        return;
      }

      let url: URL;
      try {
        url = new URL(req.url ?? "/", "http://127.0.0.1");
      } catch {
        res.writeHead(400, { ...corsHeaders }).end();
        return;
      }

      const pathParam = url.searchParams.get("path");
      if (pathParam === null || pathParam === "") {
        res.writeHead(400, { ...corsHeaders }).end();
        return;
      }

      let decodedPath: string;
      try {
        decodedPath = decodeURIComponent(pathParam);
      } catch {
        res.writeHead(400, { ...corsHeaders }).end();
        return;
      }

      const resolvedFile = path.resolve(decodedPath);
      const rangeHeader = singleHeader(req.headers.range);

      const getOrHead = req.method === "GET" ? "GET" : "HEAD";

      if (url.pathname === "/audio") {
        if (!isPathUnderRoot(resolvedFile, libraryRoot)) {
          console.warn("[spire] audio-server: 403 /audio outside library root", {
            resolvedFile,
            libraryRoot,
          });
          res.writeHead(403, { ...corsHeaders }).end();
          return;
        }
        const ctype = contentTypeForAudioPath(resolvedFile);
        respondWithRangedFile(res, resolvedFile, ctype, rangeHeader, getOrHead);
        return;
      }

      if (url.pathname === "/cover") {
        if (!isPathUnderRoot(resolvedFile, coversRoot)) {
          res.writeHead(403, { ...corsHeaders }).end();
          return;
        }
        const ctype = contentTypeForImagePath(resolvedFile);
        respondWithRangedFile(res, resolvedFile, ctype, rangeHeader, getOrHead);
        return;
      }

      res.writeHead(404, { ...corsHeaders }).end();
    } catch (e) {
      console.error("[spire] audio-server: unhandled", e);
      if (!res.headersSent) {
        res.writeHead(500, { ...corsHeaders }).end();
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off("error", onError);
      reject(err);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  const addr = server.address();
  if (addr === null || typeof addr === "string") {
    server.close();
    throw new Error("Audio server did not bind to a port");
  }

  _port = addr.port;
  console.log("[spire] audio server listening on port", _port);

  return {
    port: _port,
    close: () => {
      server.close();
      _port = null;
    },
  };
}
