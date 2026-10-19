import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DesktopAutoUpdateLogger } from "./desktop-auto-update.js";

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVED_LOG_FILES = 4;

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function createDesktopLogger(args: {
  logDir: string;
}): DesktopAutoUpdateLogger {
  const filePath = join(args.logDir, "desktop.log");
  let logDirReady = false;
  let reportedWriteFailure = false;

  function writeStderr(message: string): void {
    try {
      process.stderr.write(`${message}\n`);
    } catch {}
  }

  function currentLogBytes(): number {
    try {
      return statSync(filePath).size;
    } catch (error) {
      if (isMissingFileError(error)) return 0;
      throw error;
    }
  }

  function archivePath(index: number): string {
    return join(args.logDir, `desktop.${index}.log`);
  }

  function rotate(): void {
    for (let index = MAX_ARCHIVED_LOG_FILES; index > 1; index -= 1) {
      try {
        renameSync(archivePath(index - 1), archivePath(index));
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
      }
    }
    renameSync(filePath, archivePath(1));
  }

  function write(level: number, message: string): void {
    const record = `${JSON.stringify({ component: "desktop", level, time: Date.now(), msg: message })}\n`;
    try {
      if (!logDirReady) {
        mkdirSync(args.logDir, { recursive: true });
        logDirReady = true;
      }
      const size = currentLogBytes();
      if (size > 0 && size + Buffer.byteLength(record) > MAX_LOG_BYTES) {
        rotate();
      }
      appendFileSync(filePath, record, { mode: 0o600 });
      reportedWriteFailure = false;
    } catch (error) {
      logDirReady = false;
      if (!reportedWriteFailure) {
        reportedWriteFailure = true;
        writeStderr(
          `[desktop] could not write ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    writeStderr(message);
  }

  return {
    error: (message) => write(50, message),
    info: (message) => write(30, message),
    warn: (message) => write(40, message),
  };
}
