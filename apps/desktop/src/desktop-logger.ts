import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type { DesktopAutoUpdateLogger } from "./desktop-auto-update.js";

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const MAX_LOG_FILES = 5;

export function createDesktopLogger(args: {
  logDir: string;
}): DesktopAutoUpdateLogger {
  const filePath = join(args.logDir, "desktop.log");
  let reportedWriteFailure = false;

  function writeStderr(message: string): void {
    try {
      process.stderr.write(`${message}\n`);
    } catch {}
  }

  function write(level: number, message: string): void {
    const record = `${JSON.stringify({ component: "desktop", level, time: Date.now(), msg: message })}\n`;
    try {
      mkdirSync(args.logDir, { recursive: true });
      if (
        existsSync(filePath) &&
        statSync(filePath).size + Buffer.byteLength(record) > MAX_LOG_BYTES
      ) {
        for (let index = MAX_LOG_FILES - 1; index > 0; index -= 1) {
          const source = index === 1 ? filePath : `${filePath}.${index - 1}`;
          if (existsSync(source)) renameSync(source, `${filePath}.${index}`);
        }
      }
      appendFileSync(filePath, record, { mode: 0o600 });
      reportedWriteFailure = false;
    } catch (error) {
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
