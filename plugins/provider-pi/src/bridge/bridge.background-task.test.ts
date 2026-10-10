import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { experimental_assembleCapturedThreadEvents as assembleCapturedThreadEvents } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { afterEach, beforeEach, expect, it } from "vitest";
import { z } from "zod";
import { vi } from "vitest";
import { PI_BRIDGE_COMMAND_ENV, PI_BRIDGE_ARGS_ENV } from "./rpc-child.js";
import { fakePiPath } from "./test-support.js";
import {
  FULL_PERMISSION_OPTIONS,
  type FakePiBridgeHarness,
  startFakePiBridge,
} from "./test-support.js";

let harness: FakePiBridgeHarness;
let requestId = 500;
const threadId = "thr_background";
const taskSchema = z.object({
  type: z.literal("backgroundTask"),
  familyId: z.string(),
  taskStatus: z.string(),
  outputFile: z.string(),
  error: z.string().optional(),
  summary: z.string().optional(),
});

beforeEach(async () => {
  vi.stubEnv("FAKE_PI_COMPACT_DELAY_MS", "1200");
  harness = await startFakePiBridge({
    prefix: "bb-pi-background-",
    initialize: true,
  });
  await harness.startThread(threadId);
});

afterEach(async () => {
  await harness.teardown();
});

function providerId(target = threadId): string {
  const identity = [...harness.messages]
    .reverse()
    .find(
      (message) =>
        message.method === "thread/identity" &&
        z.object({ threadId: z.string() }).parse(message.params).threadId ===
          target,
    );
  return z.object({ providerThreadId: z.string() }).parse(identity?.params)
    .providerThreadId;
}

async function prompt(text: string, target = threadId): Promise<void> {
  const response = await harness.request(++requestId, "turn/start", {
    threadId: target,
    providerThreadId: providerId(target),
    clientRequestId: "creq_bg23456789",
    input:
      text === "/compact"
        ? [
            {
              type: "text",
              text,
              mentions: [
                {
                  start: 0,
                  end: 8,
                  resource: {
                    kind: "command",
                    trigger: "/",
                    name: "compact",
                    source: "command",
                    origin: "builtin",
                    label: "compact",
                    argumentHint: null,
                  },
                },
              ],
            },
          ]
        : [{ type: "text", text, mentions: [] }],
    options: FULL_PERMISSION_OPTIONS,
  });
  expect(response.error).toBeUndefined();
}

function tasks(kind: string, target = threadId) {
  return harness
    .deltasOf(target)
    .filter((delta) => delta.kind === kind)
    .flatMap((delta) => {
      const parsed = taskSchema.safeParse(delta.item);
      return parsed.success ? [parsed.data] : [];
    });
}

function nodeCommand(code: string): string {
  return `"${process.execPath}" -e "${code}"`;
}

async function launch(command: string, extra = {}): Promise<void> {
  await prompt(
    `/tool background_task ${JSON.stringify({ command, description: "test task", ...extra })}`,
  );
  await harness.waitForTurnBoundary(threadId);
}

it("returns before the command finishes, closes one card, and triggers idle completion input", async () => {
  const started = Date.now();
  await launch(nodeCommand("setTimeout(() => console.log('DONE'), 2000)"));
  expect(Date.now() - started).toBeLessThan(1500);
  expect(tasks("item.open")).toHaveLength(1);
  expect(tasks("item.close")).toHaveLength(0);
  const opened = tasks("item.open")[0]!;
  expect(opened.taskStatus).toBe("running");
  await harness.waitForDelta(
    threadId,
    (delta) =>
      delta.kind === "item.close" && taskSchema.safeParse(delta.item).success,
  );
  const completed = tasks("item.close");
  expect(completed).toHaveLength(1);
  expect(completed[0]).toMatchObject({
    familyId: opened.familyId,
    taskStatus: "completed",
    summary: "DONE\n",
  });
  expect(readFileSync(opened.outputFile, "utf8")).toBe("DONE\n");
  await harness.waitForDelta(
    threadId,
    (delta) =>
      delta.kind === "input.provider" && String(delta.text).includes("DONE"),
  );
  await harness.waitForDelta(
    threadId,
    (delta) =>
      delta.kind === "item.textDelta" &&
      String(delta.text).includes("Background task"),
  );
});

it.each([
  {
    command: nodeCommand("console.log('FAILED'); process.exit(7)"),
    extra: {},
    status: "failed",
    error: "exit 7",
  },
  {
    command: nodeCommand("setTimeout(() => {}, 20000)"),
    extra: { timeout_sec: 1 },
    status: "failed",
    error: "timeout",
  },
])(
  "delivers $error once with a failed card",
  async ({ command, extra, status, error }) => {
    await launch(command, extra);
    await harness.waitForDelta(
      threadId,
      (delta) =>
        delta.kind === "item.close" && taskSchema.safeParse(delta.item).success,
    );
    expect(tasks("item.close")).toHaveLength(1);
    expect(tasks("item.close")[0]).toMatchObject({ taskStatus: status, error });
  },
);

it("cancel terminates a process tree, rejects another thread's task, and closes once", async () => {
  await launch(
    nodeCommand(
      "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setTimeout(()=>{},20000)'],{stdio:'ignore'}); console.log(child.pid); setTimeout(()=>{},20000)",
    ),
  );
  const opened = tasks("item.open")[0];
  expect(opened).toBeDefined();
  if (!opened) throw new Error("missing task card");
  await harness.startThread("thr_other");
  await prompt(
    `/tool background_task_cancel ${JSON.stringify({ taskId: opened.familyId })}`,
    "thr_other",
  );
  await harness.waitForTurnBoundary("thr_other");
  expect(tasks("item.close")).toHaveLength(0);
  await prompt(
    `/tool background_task_cancel ${JSON.stringify({ taskId: opened.familyId })}`,
  );
  await harness.waitForDelta(
    threadId,
    (delta) =>
      delta.kind === "item.close" && taskSchema.safeParse(delta.item).success,
  );
  expect(tasks("item.close")).toHaveLength(1);
  expect(tasks("item.close")[0]).toMatchObject({
    taskStatus: "killed",
    error: "cancelled",
  });
  const childPid = Number(readFileSync(opened.outputFile, "utf8").trim());
  await harness.waitFor(() => {
    try {
      process.kill(childPid, 0);
      return false;
    } catch {
      return true;
    }
  }, "command descendant to exit");
});

it("release kills work before replying and emits no completion wake", async () => {
  await launch(nodeCommand("setTimeout(() => console.log('TOO_LATE'), 20000)"));
  const response = await harness.request(++requestId, "thread/stop", {
    threadId,
    providerThreadId: providerId(),
    intent: "release",
    activeTurnId: null,
  });
  expect(response.error).toBeUndefined();
  expect(tasks("item.close")).toHaveLength(1);
  expect(tasks("item.close")[0]?.taskStatus).toBe("stopped");
  expect(
    harness
      .deltasOf(threadId)
      .filter((delta) => delta.kind === "input.provider"),
  ).toHaveLength(0);
});

it("keeps large output on disk while bounding summaries and completion context", async () => {
  await launch(
    nodeCommand("process.stdout.write('x'.repeat(200000)); console.log('END')"),
  );
  await harness.waitForDelta(
    threadId,
    (delta) =>
      delta.kind === "item.close" && taskSchema.safeParse(delta.item).success,
  );
  const closed = tasks("item.close")[0]!;
  expect(existsSync(closed.outputFile)).toBe(true);
  expect(readFileSync(closed.outputFile).byteLength).toBeGreaterThan(200000);
  expect(closed.summary?.length).toBeLessThanOrEqual(500);
  expect(closed.summary).toContain("END");
  await harness.waitForDelta(
    threadId,
    (delta) => delta.kind === "input.provider",
  );
  for (const delta of harness
    .deltasOf(threadId)
    .filter((entry) => entry.kind === "input.provider")) {
    expect(String(delta.text).length).toBeLessThan(1500);
  }
});

it("delivers completion into a running agent before that run ends", async () => {
  await launch(
    nodeCommand("setTimeout(() => console.log('ACTIVE_DONE'), 1500)"),
  );
  const since = harness.deltasOf(threadId).length;
  await prompt("/hold");
  await harness.waitForDelta(
    threadId,
    (delta) =>
      delta.kind === "input.provider" &&
      String(delta.text).includes("ACTIVE_DONE"),
    since,
  );
  await harness.waitForTurnBoundary(threadId, since);
  const events = harness.deltasOf(threadId).slice(since);
  expect(events.filter((delta) => delta.kind === "turn.open")).toHaveLength(1);
  const inputIndex = events.findIndex(
    (delta) => delta.kind === "input.provider",
  );
  const boundaryIndex = events.findIndex(
    (delta) => delta.kind === "turn.boundary",
  );
  expect(inputIndex).toBeGreaterThanOrEqual(0);
  expect(boundaryIndex).toBeGreaterThan(inputIndex);
  expect(
    events.some(
      (delta) =>
        delta.kind === "item.textDelta" &&
        String(delta.text).includes("Steered: Background task"),
    ),
  ).toBe(true);
});

it("launches and delivers completion with a Bun-backed Pi child", async () => {
  const { spawnSync } = await import("node:child_process");
  if (spawnSync("bun", ["--version"]).status !== 0) {
    if (process.env.CI) throw new Error("Bun is required in CI");
    return;
  }
  await harness.request(++requestId, "thread/stop", {
    threadId,
    providerThreadId: providerId(),
    intent: "release",
    activeTurnId: null,
  });
  vi.stubEnv(PI_BRIDGE_COMMAND_ENV, "bun");
  vi.stubEnv(PI_BRIDGE_ARGS_ENV, JSON.stringify([fakePiPath]));
  await harness.startThread(threadId);
  await launch(nodeCommand("setTimeout(() => console.log('BUN_DONE'), 200)"));
  await harness.waitForDelta(
    threadId,
    (delta) =>
      delta.kind === "input.provider" &&
      String(delta.text).includes("BUN_DONE"),
  );
  expect(tasks("item.close")[0]?.taskStatus).toBe("completed");
});

it("delays completion input until manual compaction finishes", async () => {
  await launch(
    nodeCommand("setTimeout(() => console.log('COMPACT_DONE'), 500)"),
  );
  const since = harness.deltasOf(threadId).length;
  await prompt("/compact");
  await harness.waitForDelta(
    threadId,
    (delta) =>
      delta.kind === "item.close" && taskSchema.safeParse(delta.item).success,
    since,
  );
  expect(
    harness
      .deltasOf(threadId)
      .slice(since)
      .filter((delta) => delta.kind === "input.provider"),
  ).toHaveLength(0);
  await harness.waitForDelta(
    threadId,
    (delta) =>
      delta.kind === "input.provider" &&
      String(delta.text).includes("COMPACT_DONE"),
    since,
  );
  const events = harness.deltasOf(threadId).slice(since);
  const compactEnd = events.findIndex(
    (delta) => delta.kind === "context.compacted",
  );
  const completion = events.findIndex(
    (delta) => delta.kind === "input.provider",
  );
  expect(compactEnd).toBeGreaterThanOrEqual(0);
  expect(completion).toBeGreaterThan(compactEnd);
});

it("preserves task ownership and completion across execution-setting session replacement", async () => {
  await launch(
    nodeCommand("setTimeout(() => console.log('REPLACED_DONE'), 3000)"),
  );
  const opened = tasks("item.open")[0]!;
  const since = harness.deltasOf(threadId).length;
  for (const setting of ["first", "second"]) {
    const response = await harness.request(++requestId, "turn/start", {
      threadId,
      providerThreadId: providerId(),
      clientRequestId: "creq_bg23456789",
      input: [{ type: "text", text: "continue work", mentions: [] }],
      options: {
        ...FULL_PERMISSION_OPTIONS,
        envVars: { PI_BG_TEST_SETTING: setting },
      },
    });
    expect(response.error).toBeUndefined();
  }
  await harness.waitForDelta(
    threadId,
    (delta) =>
      delta.kind === "input.provider" &&
      String(delta.text).includes("REPLACED_DONE"),
    since,
  );
  const events = assembleCapturedThreadEvents(harness.messages);
  const openIds = new Set<string>();
  for (const event of events) {
    if (!("item" in event) || event.item.type !== "backgroundTask") continue;
    if (event.type === "item/backgroundTask/progress")
      expect(openIds.has(event.item.id)).toBe(true);
    if (event.item.status === "pending") openIds.add(event.item.id);
    else openIds.delete(event.item.id);
  }
  expect([...openIds]).toEqual([]);
  expect(tasks("item.close").at(-1)).toMatchObject({
    familyId: opened.familyId,
    taskStatus: "completed",
  });
});

it("delivers completion to the original session after replacement startup fails", async () => {
  const wrapper = join(harness.workspaceDir, "failed-pi.mjs");
  writeFileSync(
    wrapper,
    `if (process.env.PI_BG_FAIL_REBUILD === '1') { await new Promise(r => setTimeout(r, 1800)); process.exit(17); } await import(${JSON.stringify(pathToFileURL(fakePiPath).href)});`,
  );
  vi.stubEnv(PI_BRIDGE_ARGS_ENV, JSON.stringify([wrapper]));
  await launch(
    nodeCommand("setTimeout(() => console.log('RESTORED_DONE'), 800)"),
  );
  const since = harness.deltasOf(threadId).length;
  const response = await harness.request(++requestId, "turn/start", {
    threadId,
    providerThreadId: providerId(),
    clientRequestId: "creq_bg23456789",
    input: [{ type: "text", text: "continue work", mentions: [] }],
    options: {
      ...FULL_PERMISSION_OPTIONS,
      envVars: { PI_BG_FAIL_REBUILD: "1" },
    },
  });
  expect(response.error).toBeDefined();
  await prompt("continue after failed replacement");
  await harness.waitForTurnBoundary(threadId, since);
  expect(
    harness
      .deltasOf(threadId)
      .filter(
        (delta) =>
          delta.kind === "input.provider" &&
          String(delta.text).includes("RESTORED_DONE"),
      ),
  ).toHaveLength(1);
  expect(tasks("item.close").at(-1)?.taskStatus).toBe("completed");
});

it.skipIf(process.platform === "win32").each(["timeout", "release"] as const)(
  "bounds %s even when the worker is suspended",
  async (mode) => {
    await launch(
      'echo WORKER_PAUSED; kill -STOP "$PPID"; sleep 30',
      mode === "timeout" ? { timeout_sec: 1 } : {},
    );
    const opened = tasks("item.open")[0]!;
    const registry = z
      .array(z.object({ pid: z.number() }))
      .parse(
        JSON.parse(
          readFileSync(join(opened.outputFile, "..", "registry.json"), "utf8"),
        ),
      );
    const pid = registry[0]!.pid;
    process.kill(pid, "SIGSTOP");
    await new Promise((resolve) => setTimeout(resolve, 30));
    let settled = false;
    let disposal: Promise<unknown> = Promise.resolve();
    try {
      if (mode === "release")
        disposal = harness
          .request(++requestId, "thread/stop", {
            threadId,
            providerThreadId: providerId(),
            intent: "release",
            activeTurnId: null,
          })
          .then((response) => {
            expect(response.error).toBeUndefined();
            settled = true;
          });
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (mode === "release") expect(settled).toBe(true);
      expect(tasks("item.close")).toHaveLength(1);
      expect(tasks("item.close")[0]).toMatchObject({
        taskStatus: mode === "timeout" ? "failed" : "stopped",
        ...(mode === "timeout" ? { error: "timeout" } : {}),
      });
    } finally {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {}
      await disposal;
    }
  },
);
