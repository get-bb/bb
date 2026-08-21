import { fork, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const workerEntryPath = fileURLToPath(
  new URL("./plugin-host-worker.ts", import.meta.url),
);

describe("plugin host worker lifecycle", () => {
  const children = new Set<ChildProcess>();
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const child of children) child.kill("SIGKILL");
    children.clear();
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function startWorker(
    artifactSource: string,
    disposeTimeoutMs = 50,
  ): Promise<ChildProcess> {
    const root = await mkdtemp(join(tmpdir(), "bb-plugin-worker-test-"));
    tempDirs.push(root);
    const artifactPath = join(root, "host.mjs");
    const dataDir = join(root, "data");
    const workerTempDir = join(root, "temp");
    await Promise.all([
      writeFile(artifactPath, artifactSource),
      mkdir(dataDir),
      mkdir(workerTempDir),
    ]);
    const child = fork(
      workerEntryPath,
      [
        artifactPath,
        "fixture",
        "generation-1",
        dataDir,
        workerTempDir,
        String(disposeTimeoutMs),
      ],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    children.add(child);
    child.once("close", () => children.delete(child));
    return child;
  }

  function waitForClose(
    child: ChildProcess,
    timeoutMs = 2_000,
  ): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("host worker did not exit")),
        timeoutMs,
      );
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
  }

  function waitForReady(child: ChildProcess): Promise<void> {
    return waitForMessageType(child, "ready");
  }

  function waitForMessageType(
    child: ChildProcess,
    type: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`host worker did not send ${type}`)),
        2_000,
      );
      child.on("message", (message: unknown) => {
        if (
          typeof message === "object" &&
          message !== null &&
          Reflect.get(message, "type") === type
        ) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }

  it("exits when daemon IPC disconnects during artifact import", async () => {
    const child = await startWorker(`
      process.send?.({ type: "import-started" });
      process.disconnect?.();
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      export default {};
    `);
    const closed = waitForClose(child);
    await waitForMessageType(child, "import-started");

    await expect(closed).resolves.toEqual({
      code: 0,
      signal: null,
    });
  });

  it("forces its own exit when plugin disposal hangs", async () => {
    const child = await startWorker(`
      const schema = { "~standard": { validate(value) { return { value }; } } };
      export default {
        experimental_apiVersion: 1,
        contract: { ping: { input: schema, output: schema } },
        handlers: { ping(input) { return input; } },
        dispose() { return new Promise(() => {}); },
      };
    `);
    await waitForReady(child);

    const closed = waitForClose(child);
    child.send({ type: "dispose" });

    await expect(closed).resolves.toEqual({
      code: 1,
      signal: null,
    });
  });
});
