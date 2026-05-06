import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

const LOG_BASENAME = "spire-media-playback-debug.log";

let cachedLogPath: string | null = null;

export function getMediaPlaybackDebugLogPath(): string {
  if (!cachedLogPath) {
    cachedLogPath = path.join(app.getPath("userData"), LOG_BASENAME);
  }
  return cachedLogPath;
}

type AppendOptions = {
  /** When true, also prints one line to the main process console (errors and session by default). */
  mirrorConsole?: boolean;
};

function safeJsonExtra(extra: Record<string, unknown>): Record<string, unknown> {
  try {
    JSON.stringify(extra);
    return extra;
  } catch {
    return { _serializationError: true };
  }
}

/**
 * Append one NDJSON line to the debug log on disk. Does not rely on terminal scrollback
 * (PowerShell / conhost buffer limits).
 */
export function appendMediaPlaybackDebugLine(
  event: string,
  extra: Record<string, unknown> = {},
  options: AppendOptions = {},
): void {
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    event,
    ...safeJsonExtra(extra),
  };
  const line = `${JSON.stringify(record)}\n`;
  const logPath = getMediaPlaybackDebugLogPath();
  try {
    fs.appendFileSync(logPath, line, "utf8");
  } catch (err) {
    console.error("[media-debug] appendFileSync failed:", err, "record=", record);
  }
  if (options.mirrorConsole) {
    console.log(`[media-debug] ${line.trimEnd()}`);
  }
}

export function startMediaPlaybackDebugSession(meta: Record<string, unknown> = {}): void {
  const logPath = getMediaPlaybackDebugLogPath();
  const banner = `===== Spire media playback debug session ${new Date().toISOString()} pid=${process.pid} =====\n`;
  const tailHint =
    process.platform === "win32"
      ? `PowerShell (unlimited file tail): Get-Content -Path '${logPath.replace(/'/g, "''")}' -Wait -Tail 200`
      : `tail -f '${logPath}'`;
  try {
    fs.appendFileSync(logPath, `\n${banner}`, "utf8");
  } catch {
    // ignore
  }
  appendMediaPlaybackDebugLine(
    "session.start",
    {
      logFile: logPath,
      tailHint,
      libraryNote: "All protocol + resolve + renderer lines append here (NDJSON).",
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      execPath: process.execPath,
      cwd: process.cwd(),
      userData: app.getPath("userData"),
      isPackaged: app.isPackaged,
      appVersion: app.getVersion(),
      ...meta,
    },
    { mirrorConsole: false },
  );
  console.info(`[media-debug] Playback trace log: ${logPath}`);
}
