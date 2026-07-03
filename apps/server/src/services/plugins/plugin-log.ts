import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Per-plugin log file (design §3 observability): every `bb.log` line is
 * appended as JSONL to <dataDir>/plugins/<id>/logs/plugin.log in addition to
 * the prefixed server log. Simple size rotation: past 5MB the file is renamed
 * to plugin.log.1 (one rotated file kept, replacing the previous one).
 */
const PLUGIN_LOG_MAX_BYTES = 5 * 1024 * 1024;
const PLUGIN_LOG_FILE = "plugin.log";
const PLUGIN_LOG_ROTATED_FILE = "plugin.log.1";

export type PluginLogLevel = "debug" | "info" | "warn" | "error";

function pluginLogsDir(dataDir: string, pluginId: string): string {
  return join(dataDir, "plugins", pluginId, "logs");
}

/**
 * Append one log line synchronously (bb.log is a sync API; lines are tiny).
 * Never throws — a full disk or permission problem must not break the plugin
 * call site; the prefixed server log still carries the message.
 */
export function appendPluginLogLine(
  dataDir: string,
  pluginId: string,
  level: PluginLogLevel,
  message: string,
): void {
  try {
    const dir = pluginLogsDir(dataDir, pluginId);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, PLUGIN_LOG_FILE);
    try {
      if (statSync(file).size > PLUGIN_LOG_MAX_BYTES) {
        renameSync(file, join(dir, PLUGIN_LOG_ROTATED_FILE));
      }
    } catch {
      // Missing file: nothing to rotate.
    }
    const line = JSON.stringify({ ts: Date.now(), level, message });
    appendFileSync(file, `${line}\n`, "utf8");
  } catch {
    // Best effort only.
  }
}

function splitLines(content: string): string[] {
  return content.split("\n").filter((line) => line.length > 0);
}

/**
 * Last `tail` log lines across the rotated file plus the current one, oldest
 * first. Missing files read as empty.
 */
export async function readPluginLogTail(
  dataDir: string,
  pluginId: string,
  tail: number,
): Promise<string[]> {
  const dir = pluginLogsDir(dataDir, pluginId);
  const lines: string[] = [];
  for (const name of [PLUGIN_LOG_ROTATED_FILE, PLUGIN_LOG_FILE]) {
    try {
      lines.push(...splitLines(await readFile(join(dir, name), "utf8")));
    } catch {
      // Missing file: nothing logged there yet.
    }
  }
  return tail <= 0 ? [] : lines.slice(-tail);
}
