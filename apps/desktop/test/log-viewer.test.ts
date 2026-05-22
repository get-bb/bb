import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLogLineBuffer,
  createLogTailer,
  resolveCurrentLogFile,
  type LogTailer,
} from "../src/log-viewer.js";
import type { LogViewerLine } from "../src/log-viewer-contract.js";

interface TempDir {
  path: string;
}

interface WaitForArgs {
  predicate(): boolean;
  timeoutMs?: number;
}

interface CreateTestLogLineArgs {
  index: number;
}

const tempDirs: TempDir[] = [];
const tailers: LogTailer[] = [];

async function createTempDir(): Promise<TempDir> {
  const path = await mkdtemp(join(tmpdir(), "bb-desktop-log-viewer-"));
  const tempDir = { path };
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  while (tailers.length > 0) {
    tailers.pop()?.stop();
  }
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir !== undefined) {
      await rm(tempDir.path, { force: true, recursive: true });
    }
  }
});

async function waitFor(args: WaitForArgs): Promise<void> {
  const timeoutMs = args.timeoutMs ?? 5_000;
  const startedAt = Date.now();
  while (!args.predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, 25);
    });
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function createTestLogLine(args: CreateTestLogLineArgs): LogViewerLine {
  return {
    source: "server",
    text: `line-${args.index}`,
  };
}

describe("log viewer", () => {
  it("selects the newest matching server log file", async () => {
    const tempDir = await createTempDir();
    const firstServerLog = join(tempDir.path, "server.1.log");
    const nextServerLog = join(tempDir.path, "server.2.log");
    await writeFile(firstServerLog, "older\n");
    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, 10);
    });
    await writeFile(nextServerLog, "newer\n");
    await writeFile(join(tempDir.path, "host-daemon.9.log"), "ignored\n");

    await expect(
      resolveCurrentLogFile({
        component: "server",
        logDir: tempDir.path,
      }),
    ).resolves.toBe(nextServerLog);
  });

  it("returns null when no matching component log exists", async () => {
    const tempDir = await createTempDir();
    await writeFile(join(tempDir.path, "host-daemon.1.log"), "daemon\n");

    await expect(
      resolveCurrentLogFile({
        component: "server",
        logDir: tempDir.path,
      }),
    ).resolves.toBeNull();
  });

  it("streams appended log lines from the active server log", async () => {
    const tempDir = await createTempDir();
    const lines: LogViewerLine[] = [];
    await writeFile(join(tempDir.path, "server.1.log"), "");
    const tailer = createLogTailer({
      logDir: tempDir.path,
      onLines(newLines) {
        lines.push(...newLines);
      },
    });
    tailers.push(tailer);
    await tailer.start();

    await appendFile(join(tempDir.path, "server.1.log"), "streamed\n");

    await waitFor({
      predicate() {
        return lines.some((line) => line.text.includes("streamed"));
      },
    });
    expect(lines.some((line) => line.text === "[server] streamed")).toBe(true);
  });

  it("follows a newer rotated server log file", async () => {
    const tempDir = await createTempDir();
    const lines: LogViewerLine[] = [];
    await writeFile(join(tempDir.path, "server.1.log"), "first\n");
    const tailer = createLogTailer({
      logDir: tempDir.path,
      onLines(newLines) {
        lines.push(...newLines);
      },
    });
    tailers.push(tailer);
    await tailer.start();
    await waitFor({
      predicate() {
        return lines.some((line) => line.text === "[server] first");
      },
    });

    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, 25);
    });
    await writeFile(join(tempDir.path, "server.2.log"), "second\n");

    await waitFor({
      predicate() {
        return lines.some((line) => line.text === "[server] second");
      },
    });
  });

  it("kills tail child processes when stopped", async () => {
    const tempDir = await createTempDir();
    await writeFile(join(tempDir.path, "server.1.log"), "");
    await writeFile(join(tempDir.path, "host-daemon.1.log"), "");
    const tailer = createLogTailer({
      logDir: tempDir.path,
      onLines() {},
    });
    tailers.push(tailer);
    await tailer.start();

    const processIds = tailer.processIds();
    expect(processIds).toHaveLength(2);
    expect(processIds.every(isProcessRunning)).toBe(true);

    tailer.stop();
    await waitFor({
      predicate() {
        return processIds.every((pid) => !isProcessRunning(pid));
      },
    });
  });

  it("caps the in-memory line buffer to the configured line limit", () => {
    const buffer = createLogLineBuffer({
      flushIntervalMs: 1_000,
      flushLineCount: 20_000,
      maxLines: 10_000,
      onFlush() {},
    });
    const lines = Array.from({ length: 11_000 }, (_value, index) =>
      createTestLogLine({ index }),
    );

    buffer.append(lines);

    const bufferedLines = buffer.lines();
    expect(bufferedLines).toHaveLength(10_000);
    expect(bufferedLines[0]?.text).toBe("line-1000");
    expect(bufferedLines[9_999]?.text).toBe("line-10999");
    buffer.stop();
  });

  it("batches appended lines before flushing to the renderer", async () => {
    const flushedBatches: LogViewerLine[][] = [];
    const buffer = createLogLineBuffer({
      flushIntervalMs: 25,
      flushLineCount: 10,
      maxLines: 100,
      onFlush(lines) {
        flushedBatches.push(lines);
      },
    });

    buffer.append([createTestLogLine({ index: 1 })]);
    buffer.append([createTestLogLine({ index: 2 })]);

    await waitFor({
      predicate() {
        return flushedBatches.length === 1;
      },
    });
    expect(flushedBatches[0]?.map((line) => line.text)).toEqual([
      "line-1",
      "line-2",
    ]);
    buffer.stop();
  });
});
