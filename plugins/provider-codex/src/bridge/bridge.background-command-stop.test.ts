import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { z } from "zod";
import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

const THREAD_ID = "thr_background_command_stop";

const backgroundTaskDeltaSchema = z.object({
  kind: z.enum(["item.open", "item.close"]),
  item: z.object({
    type: z.literal("backgroundTask"),
    familyId: z.string(),
    taskStatus: z.string(),
    stoppable: z.literal(true).optional(),
  }),
});

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;
let requestLogPath: string;
let providerThreadId: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-bg-stop-ws-"));
  requestLogPath = join(workspaceDir, "requests.ndjson");
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

function startFakeCodex(script: Record<string, unknown> = {}): void {
  const scriptPath = join(workspaceDir, "script.json");
  writeFileSync(scriptPath, JSON.stringify({ requestLogPath, ...script }));
  stubFakeCodexAppServer(scriptPath);
}

async function startBackgroundCommand(): Promise<void> {
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  providerThreadId = z
    .object({ providerThreadId: z.string() })
    .parse((await harness.waitForResponse(1)).result).providerThreadId;
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_bgstqpxyzw",
    input: [{ type: "text", text: "/background-command", mentions: [] }],
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  expect((await harness.waitForResponse(2)).error).toBeUndefined();
}

afterEach(async () => {
  const cleanupId = 995_001;
  harness.sendRequest(cleanupId, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId,
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(cleanupId).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

function backgroundTaskDeltas() {
  return harness.messages
    .filter((message) => message.method === "thread/delta")
    .flatMap((message) => {
      const deltas = z
        .object({ deltas: z.array(z.unknown()) })
        .safeParse(message.params);
      return deltas.success ? deltas.data.deltas : [];
    })
    .flatMap((delta) => {
      const parsed = backgroundTaskDeltaSchema.safeParse(delta);
      return parsed.success ? [parsed.data] : [];
    });
}

async function waitForBackgroundTaskDeltas(count: number) {
  const deadline = Date.now() + 15_000;
  while (backgroundTaskDeltas().length < count) {
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for ${count} background task deltas; saw ${JSON.stringify(backgroundTaskDeltas())}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return backgroundTaskDeltas();
}

function terminateRequests(): unknown[] {
  return readFileSync(requestLogPath, "utf8")
    .trim()
    .split("\n")
    .map((line): unknown => JSON.parse(line))
    .filter(
      (request) =>
        z
          .object({ method: z.literal("thread/backgroundTerminals/terminate") })
          .safeParse(request).success,
    );
}

it("stops one background command through Codex's terminal API", async () => {
  startFakeCodex();
  await startBackgroundCommand();
  const [opened] = await waitForBackgroundTaskDeltas(1);
  expect(opened).toEqual({
    kind: "item.open",
    item: expect.objectContaining({
      familyId: "exec-fx-1",
      taskStatus: "running",
      stoppable: true,
    }),
  });

  harness.sendRequest(3, "thread/backgroundTask/stop", {
    threadId: THREAD_ID,
    providerThreadId,
    familyId: "exec-fx-1",
  });
  expect(await harness.waitForResponse(3)).toMatchObject({ result: {} });

  expect(terminateRequests()).toEqual([
    {
      method: "thread/backgroundTerminals/terminate",
      params: { threadId: providerThreadId, processId: "proc-fx-1" },
    },
  ]);
  const [, closed] = await waitForBackgroundTaskDeltas(2);
  expect(closed).toEqual({
    kind: "item.close",
    item: expect.objectContaining({
      familyId: "exec-fx-1",
      taskStatus: "stopped",
    }),
  });

  harness.sendRequest(4, "thread/backgroundTask/stop", {
    threadId: THREAD_ID,
    providerThreadId,
    familyId: "exec-fx-1",
  });
  expect((await harness.waitForResponse(4)).error?.message).toContain(
    "not running background command exec-fx-1",
  );
  expect(terminateRequests()).toHaveLength(1);
}, 30_000);

it("settles a background command Codex no longer runs instead of leaving it stoppable", async () => {
  startFakeCodex({ terminateFindsNoTerminal: true });
  await startBackgroundCommand();
  await waitForBackgroundTaskDeltas(1);

  harness.sendRequest(3, "thread/backgroundTask/stop", {
    threadId: THREAD_ID,
    providerThreadId,
    familyId: "exec-fx-1",
  });

  expect(await harness.waitForResponse(3)).toMatchObject({ result: {} });
  const [, closed] = await waitForBackgroundTaskDeltas(2);
  expect(closed).toEqual({
    kind: "item.close",
    item: expect.objectContaining({
      familyId: "exec-fx-1",
      taskStatus: "stopped",
    }),
  });
}, 30_000);
