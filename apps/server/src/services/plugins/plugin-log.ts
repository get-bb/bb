import { mkdirSync, renameSync, statSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Per-plugin log file (design §3 observability): every `bb.log` line is
 * appended as JSONL to <dataDir>/plugins/<id>/logs/plugin.log in addition to
 * the prefixed server log. Simple size rotation: past 5MB the file is renamed
 * to plugin.log.1 (one rotated file kept, replacing the previous one).
 *
 * `bb.log` runs on the server event loop, so lines are buffered and flushed
 * as one async append per window (or once the buffer crosses a byte
 * threshold) instead of a mkdir + stat + sync append per line. The directory
 * is created once per writer lifetime and the rotation size is tracked from
 * a cached counter seeded by one stat. Delivery stays best effort — it
 * already was, and the prefixed server log still carries every message.
 */
const PLUGIN_LOG_MAX_BYTES = 5 * 1024 * 1024;
const PLUGIN_LOG_FILE = "plugin.log";
const PLUGIN_LOG_ROTATED_FILE = "plugin.log.1";
const PLUGIN_LOG_FLUSH_INTERVAL_MS = 200;
const PLUGIN_LOG_FLUSH_THRESHOLD_BYTES = 8 * 1024;

type PluginLogLevel = "debug" | "info" | "warn" | "error";

interface PluginLogWriter {
  bufferedBytes: number;
  bufferedLines: string[];
  dirEnsured: boolean;
  /** Serializes flushes so appended lines keep their order. */
  flushChain: Promise<void>;
  /** Cached plugin.log size; null until seeded by the writer's one stat. */
  logFileBytes: number | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const pluginLogWriters = new Map<string, PluginLogWriter>();

function pluginLogsDir(dataDir: string, pluginId: string): string {
  return join(dataDir, "plugins", pluginId, "logs");
}

function pluginLogWriterKey(dataDir: string, pluginId: string): string {
  return `${dataDir}\u0000${pluginId}`;
}

function getPluginLogWriter(dataDir: string, pluginId: string): PluginLogWriter {
  const key = pluginLogWriterKey(dataDir, pluginId);
  const existing = pluginLogWriters.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const writer: PluginLogWriter = {
    bufferedBytes: 0,
    bufferedLines: [],
    dirEnsured: false,
    flushChain: Promise.resolve(),
    logFileBytes: null,
    timer: null,
  };
  pluginLogWriters.set(key, writer);
  return writer;
}

function flushPluginLogWriter(
  dataDir: string,
  pluginId: string,
  writer: PluginLogWriter,
): Promise<void> {
  if (writer.timer !== null) {
    clearTimeout(writer.timer);
    writer.timer = null;
  }
  if (writer.bufferedLines.length === 0) {
    return writer.flushChain;
  }
  const chunk = writer.bufferedLines.join("");
  const chunkBytes = writer.bufferedBytes;
  writer.bufferedLines = [];
  writer.bufferedBytes = 0;
  writer.flushChain = writer.flushChain.then(async () => {
    try {
      const dir = pluginLogsDir(dataDir, pluginId);
      if (!writer.dirEnsured) {
        mkdirSync(dir, { recursive: true });
        writer.dirEnsured = true;
      }
      const file = join(dir, PLUGIN_LOG_FILE);
      if (writer.logFileBytes === null) {
        try {
          writer.logFileBytes = statSync(file).size;
        } catch {
          // Missing file: nothing logged there yet.
          writer.logFileBytes = 0;
        }
      }
      if (writer.logFileBytes > PLUGIN_LOG_MAX_BYTES) {
        try {
          renameSync(file, join(dir, PLUGIN_LOG_ROTATED_FILE));
        } catch {
          // Missing file: nothing to rotate.
        }
        writer.logFileBytes = 0;
      }
      await appendFile(file, chunk, "utf8");
      writer.logFileBytes += chunkBytes;
    } catch {
      // Best effort only — a full disk or permission problem must not break
      // the plugin call site; the prefixed server log still carries the
      // messages.
    }
  });
  return writer.flushChain;
}

/**
 * Flush and drop a plugin's buffered log writer. Wired into the plugin API
 * handle's dispose hooks so reload/disable/shutdown wait for pending lines
 * instead of leaving a flush timer racing the plugin data directory's
 * removal.
 */
export async function disposePluginLogWriter(
  dataDir: string,
  pluginId: string,
): Promise<void> {
  const key = pluginLogWriterKey(dataDir, pluginId);
  const writer = pluginLogWriters.get(key);
  if (writer === undefined) {
    return;
  }
  pluginLogWriters.delete(key);
  await flushPluginLogWriter(dataDir, pluginId, writer);
}

/**
 * Buffer one log line (bb.log is a sync API; lines are tiny). Never throws —
 * delivery is best effort and happens off the call path.
 */
export function appendPluginLogLine(
  dataDir: string,
  pluginId: string,
  level: PluginLogLevel,
  message: string,
): void {
  try {
    const writer = getPluginLogWriter(dataDir, pluginId);
    const line = `${JSON.stringify({ ts: Date.now(), level, message })}\n`;
    writer.bufferedLines.push(line);
    writer.bufferedBytes += Buffer.byteLength(line, "utf8");
    if (writer.bufferedBytes >= PLUGIN_LOG_FLUSH_THRESHOLD_BYTES) {
      void flushPluginLogWriter(dataDir, pluginId, writer);
      return;
    }
    if (writer.timer === null) {
      writer.timer = setTimeout(() => {
        writer.timer = null;
        void flushPluginLogWriter(dataDir, pluginId, writer);
      }, PLUGIN_LOG_FLUSH_INTERVAL_MS);
      writer.timer.unref?.();
    }
  } catch {
    // Best effort only.
  }
}

function splitLines(content: string): string[] {
  return content.split("\n").filter((line) => line.length > 0);
}

/**
 * Last `tail` log lines across the rotated file plus the current one, oldest
 * first. Missing files read as empty. Pending buffered lines are flushed
 * first so a tail right after `bb.log` stays read-your-writes.
 */
export async function readPluginLogTail(
  dataDir: string,
  pluginId: string,
  tail: number,
): Promise<string[]> {
  const writer = pluginLogWriters.get(pluginLogWriterKey(dataDir, pluginId));
  if (writer !== undefined) {
    await flushPluginLogWriter(dataDir, pluginId, writer);
  }
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
