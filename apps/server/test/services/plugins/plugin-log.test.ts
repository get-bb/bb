import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  appendPluginLogLine,
  readPluginLogTail,
} from "../../../src/services/plugins/plugin-log.js";

function logFilePath(dataDir: string, pluginId: string): string {
  return join(dataDir, "plugins", pluginId, "logs", "plugin.log");
}

function fileLines(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

async function withDataDir(
  run: (dataDir: string) => Promise<void>,
): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-plugin-log-"));
  try {
    await run(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

describe("plugin log batching", () => {
  it("buffers lines off the call path and flushes them as one batch", async () => {
    await withDataDir(async (dataDir) => {
      for (let index = 0; index < 3; index += 1) {
        appendPluginLogLine(dataDir, "batch", "info", `line-${index}`);
      }
      // Nothing hits the disk synchronously on the call path.
      expect(existsSync(logFilePath(dataDir, "batch"))).toBe(false);

      // The tail flushes pending lines first, so reads stay read-your-writes.
      const lines = await readPluginLogTail(dataDir, "batch", 10);
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0] ?? "")).toMatchObject({
        level: "info",
        message: "line-0",
      });
      expect(fileLines(logFilePath(dataDir, "batch"))).toHaveLength(3);
    });
  });

  it("flushes on the timer without a reader", async () => {
    await withDataDir(async (dataDir) => {
      appendPluginLogLine(dataDir, "timer", "warn", "solo");
      expect(existsSync(logFilePath(dataDir, "timer"))).toBe(false);

      await vi.waitFor(
        () => {
          expect(existsSync(logFilePath(dataDir, "timer"))).toBe(true);
        },
        { timeout: 2_000 },
      );
      expect(fileLines(logFilePath(dataDir, "timer"))).toHaveLength(1);
    });
  });

  it("flushes immediately once the buffer crosses the byte threshold", async () => {
    await withDataDir(async (dataDir) => {
      const big = "x".repeat(4 * 1024);
      appendPluginLogLine(dataDir, "burst", "info", big);
      expect(existsSync(logFilePath(dataDir, "burst"))).toBe(false);

      // The second line crosses the 8KB threshold: no timer wait.
      appendPluginLogLine(dataDir, "burst", "info", big);
      await vi.waitFor(
        () => {
          expect(existsSync(logFilePath(dataDir, "burst"))).toBe(true);
        },
        { timeout: 500 },
      );
      expect(fileLines(logFilePath(dataDir, "burst"))).toHaveLength(2);
    });
  });

  it("rotates past the size cap using the cached size counter", async () => {
    await withDataDir(async (dataDir) => {
      appendPluginLogLine(
        dataDir,
        "rotate",
        "info",
        "x".repeat(6 * 1024 * 1024),
      );
      await readPluginLogTail(dataDir, "rotate", 1);

      appendPluginLogLine(dataDir, "rotate", "info", "after-rotation");
      const lines = await readPluginLogTail(dataDir, "rotate", 10);

      const dir = join(dataDir, "plugins", "rotate", "logs");
      expect(existsSync(join(dir, "plugin.log.1"))).toBe(true);
      expect(fileLines(logFilePath(dataDir, "rotate"))).toHaveLength(1);
      // The tail spans the rotated file plus the current one.
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[1] ?? "")).toMatchObject({
        message: "after-rotation",
      });
    });
  });
});
