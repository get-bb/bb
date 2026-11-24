import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServerLogger } from "../../types.js";
import { pluginDirectory } from "./plugin-directory.js";

const PLUGIN_LOG_MAX_BYTES = 5 * 1024 * 1024;
const PLUGIN_LOG_FILE = "plugin.log";
const PLUGIN_LOG_ROTATED_FILE = "plugin.log.1";

type PluginLogLevel = "debug" | "info" | "warn" | "error";

export type PluginEventLog = Record<
  PluginLogLevel,
  (pluginId: string, message: string, error?: unknown) => void
>;

function appendPluginLogLine(
  dataDir: string,
  pluginId: string,
  level: PluginLogLevel,
  message: string,
  stack: string | null,
): void {
  try {
    const dir = pluginDirectory(dataDir, pluginId, "logs");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, PLUGIN_LOG_FILE);
    try {
      if (statSync(file).size > PLUGIN_LOG_MAX_BYTES) {
        renameSync(file, join(dir, PLUGIN_LOG_ROTATED_FILE));
      }
    } catch {}
    const line = JSON.stringify({
      ts: Date.now(),
      level,
      message,
      ...(stack === null ? {} : { stack }),
    });
    appendFileSync(file, `${line}\n`, "utf8");
  } catch {}
}

export function createPluginEventLog(args: {
  dataDir: string;
  logger: ServerLogger;
}): PluginEventLog {
  function emit(level: PluginLogLevel) {
    return (pluginId: string, message: string, error?: unknown): void => {
      const line = `[plugin:${pluginId}] ${message}`;
      if (error === undefined) args.logger[level](line);
      else args.logger[level]({ err: error }, line);
      appendPluginLogLine(
        args.dataDir,
        pluginId,
        level,
        message,
        error instanceof Error && typeof error.stack === "string"
          ? error.stack
          : null,
      );
    };
  }
  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
  };
}

export function logPluginBuildWarnings(args: {
  pluginLog: PluginEventLog;
  pluginId: string;
  warnings: readonly string[];
}): void {
  for (const warning of args.warnings) {
    args.pluginLog.warn(args.pluginId, warning);
  }
}

function splitLines(content: string): string[] {
  return content.split("\n").filter((line) => line.length > 0);
}

export async function readPluginLogTail(
  dataDir: string,
  pluginId: string,
  tail: number,
): Promise<string[]> {
  const dir = pluginDirectory(dataDir, pluginId, "logs");
  const lines: string[] = [];
  for (const name of [PLUGIN_LOG_ROTATED_FILE, PLUGIN_LOG_FILE]) {
    try {
      lines.push(...splitLines(await readFile(join(dir, name), "utf8")));
    } catch {}
  }
  return tail <= 0 ? [] : lines.slice(-tail);
}
