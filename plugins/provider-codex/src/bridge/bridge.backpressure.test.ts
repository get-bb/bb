import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";

const workerEntry = fileURLToPath(
  new URL(
    "../../../../packages/provider-bridge-protocol/src/bridge-worker-entry.ts",
    import.meta.url,
  ),
);
const bridgeEntry = fileURLToPath(new URL("./bridge.ts", import.meta.url));
const fixtureEntry = fileURLToPath(
  new URL("./fake-codex-backpressure.mjs", import.meta.url),
);
const options = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
};
const envelopeSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  error: z.unknown().optional(),
  params: z.object({ deltas: z.array(z.unknown()).optional() }).optional(),
});
const itemSchema = z.object({
  kind: z.string(),
  key: z.object({ providerItemId: z.string() }),
  item: z.object({
    type: z.string(),
    changes: z.array(z.object({ diff: z.string() })).optional(),
  }),
});
const workers: ChildProcessWithoutNullStreams[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const worker of workers.splice(0)) {
    if (worker.exitCode === null && worker.signalCode === null)
      worker.kill("SIGKILL");
    worker.stdout.destroy();
    worker.stdin.destroy();
  }
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!(await predicate())) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for bridge progress");
    await delay(20);
  }
}

async function startWorker(mode: "burst" | "single" | "exit") {
  const directory = await mkdtemp(join(tmpdir(), "bb-codex-backpressure-"));
  directories.push(directory);
  const progressPath = join(directory, "progress");
  const worker = spawn(
    process.execPath,
    [
      "--conditions=source",
      "--import",
      import.meta.resolve("tsx"),
      workerEntry,
      bridgeEntry,
      "provider-codex",
      directory,
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        BB_PROVIDER_BRIDGE_RECORD_DIR: "",
        BB_CODEX_BRIDGE_APP_SERVER_COMMAND: process.execPath,
        BB_CODEX_BRIDGE_APP_SERVER_ARGS: JSON.stringify([
          fixtureEntry,
          mode,
          progressPath,
        ]),
      },
    },
  );
  workers.push(worker);
  const responses = new Set<string | number>();
  const items: Array<{
    kind: string;
    id: string;
    length: number;
    digest: string;
  }> = [];
  let stderr = "";
  let remainder = "";
  let parseFailure: unknown;
  let slow = false;
  let boundaries = 0;
  const exited = new Promise<number | null>((resolve, reject) => {
    worker.once("exit", resolve);
    worker.once("error", reject);
  });
  const closed = new Promise<number | null>((resolve) =>
    worker.once("close", resolve),
  );
  worker.stdin.on("error", () => {});
  worker.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  worker.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    remainder += chunk;
    let end: number;
    while ((end = remainder.indexOf("\n")) !== -1) {
      const line = remainder.slice(0, end);
      remainder = remainder.slice(end + 1);
      try {
        const envelope = envelopeSchema.parse(JSON.parse(line));
        if (envelope.error !== undefined)
          throw new Error("Unexpected bridge request error");
        if (envelope.id !== undefined) responses.add(envelope.id);
        for (const delta of envelope.params?.deltas ?? []) {
          if (
            z.object({ kind: z.literal("turn.boundary") }).safeParse(delta)
              .success
          )
            boundaries += 1;
          const parsed = itemSchema.safeParse(delta);
          if (!parsed.success) continue;
          const diff = parsed.data.item.changes?.[0]?.diff ?? "";
          items.push({
            kind: parsed.data.kind,
            id: parsed.data.key.providerItemId,
            length: diff.length,
            digest: createHash("sha256").update(diff).digest("hex"),
          });
        }
      } catch (error) {
        parseFailure = error;
      }
    }
    if (slow) {
      worker.stdout.pause();
      setTimeout(() => worker.stdout.resume(), 1);
    }
  });
  function send(id: number, method: string, params: object) {
    worker.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
  }
  send(1, "thread/start", {
    threadId: "thr_backpressure",
    cwd: directory,
    instructionMode: "append",
    options,
  });
  await waitFor(() => responses.has(1) || worker.exitCode !== null);
  expect({ stderr, response: responses.has(1) }).toEqual({
    stderr: "",
    response: true,
  });
  return {
    worker,
    items,
    exited,
    closed,
    stderr: () => stderr,
    boundaryCount: () => boundaries,
    assertParsed() {
      expect(parseFailure).toBeUndefined();
      expect(remainder.length).toBe(0);
    },
    async emitted() {
      return (await readFile(progressPath, "utf8").catch(() => ""))
        .trim()
        .split("\n");
    },
    startTurn() {
      worker.stdout.pause();
      send(2, "turn/start", {
        threadId: "thr_backpressure",
        providerThreadId: "codex-backpressure",
        input: [{ type: "text", text: "synthetic burst", mentions: [] }],
        clientRequestId: "creq_pressure22",
        options,
      });
    },
    resumeSlowly() {
      slow = true;
      worker.stdout.resume();
    },
  };
}

function expectedItem(index: number) {
  const completed = index % 2 === 1;
  const id = `patch-${Math.floor(index / 2)}`;
  const empty = JSON.stringify({
    jsonrpc: "2.0",
    method: completed ? "item/completed" : "item/started",
    params: {
      threadId: "codex-backpressure",
      turnId: "turn-backpressure",
      item: {
        type: "fileChange",
        id,
        status: completed ? "completed" : "inProgress",
        changes: [{ path: "synthetic.txt", kind: { type: "add" }, diff: "" }],
      },
    },
  });
  const length = (completed ? 11_102_429 : 9_418_764) - empty.length;
  return {
    kind: completed ? "item.close" : "item.open",
    id,
    length,
    digest: createHash("sha256")
      .update("x".repeat(length - 4))
      .update("é🙂界")
      .digest("hex"),
  };
}

it("preserves eight 9–11 MB Unicode file changes in order through a paused, slow reader", async () => {
  const bridge = await startWorker("burst");
  bridge.startTurn();
  await waitFor(async () => (await bridge.emitted()).includes("0"));
  await delay(200);
  expect((await bridge.emitted()).includes("done")).toBe(false);
  bridge.resumeSlowly();
  await waitFor(() => bridge.boundaryCount() === 1);
  bridge.worker.stdin.end();
  expect(await bridge.closed).toBe(0);
  bridge.assertParsed();
  expect(bridge.items).toEqual(
    Array.from({ length: 8 }, (_, index) => expectedItem(index)),
  );
  expect(bridge.stderr()).toBe("");
}, 30_000);

it.each(["EOF", "SIGTERM"])(
  "drains a queued large event during %s shutdown",
  async (signal) => {
    const bridge = await startWorker("single");
    bridge.startTurn();
    await waitFor(async () => (await bridge.emitted()).includes("0"));
    if (signal === "EOF") bridge.worker.stdin.end();
    else bridge.worker.kill("SIGTERM");
    await delay(200);
    bridge.resumeSlowly();
    expect(await bridge.closed).toBe(0);
    bridge.assertParsed();
    expect(bridge.items).toEqual([expectedItem(0)]);
    expect(bridge.stderr()).toBe("");
  },
  20_000,
);

it("keeps final child events when output remains paused beyond the child exit grace", async () => {
  const bridge = await startWorker("exit");
  bridge.startTurn();
  await waitFor(async () => (await bridge.emitted()).includes("done"));
  await delay(1_500);
  bridge.resumeSlowly();
  await waitFor(() => bridge.boundaryCount() > 0);
  bridge.worker.stdin.end();
  const code = await bridge.closed;
  expect(code, bridge.stderr()).toBe(0);
  bridge.assertParsed();
  expect(bridge.items[0]).toEqual(expectedItem(0));
  expect(
    bridge.items.some(
      (item) => item.id === "final-tail" && item.kind === "item.close",
    ),
  ).toBe(true);
}, 20_000);

it("reports a broken runtime socket and exits without an unhandled stream error", async () => {
  const bridge = await startWorker("single");
  bridge.startTurn();
  await waitFor(async () => (await bridge.emitted()).includes("0"));
  bridge.worker.stdout.destroy();
  expect(await bridge.closed).toBe(1);
  expect(bridge.stderr()).toContain("Codex bridge stdout failed:");
  expect(bridge.stderr()).not.toContain("Unhandled 'error' event");
}, 15_000);

it("fails shutdown explicitly when the runtime never drains its socket", async () => {
  const bridge = await startWorker("single");
  bridge.startTurn();
  await waitFor(async () => (await bridge.emitted()).includes("0"));
  bridge.worker.kill("SIGTERM");
  expect(await bridge.exited).toBe(1);
  bridge.worker.stdout.destroy();
  await bridge.closed;
  expect(bridge.stderr()).toContain("Codex bridge shutdown timed out");
}, 15_000);
