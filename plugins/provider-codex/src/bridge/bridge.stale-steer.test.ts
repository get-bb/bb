import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const THREAD_ID = "thr_stale_steer_1";
const BRIDGE_ERROR = -32000;
const NO_ACTIVE_TURN = -32001;

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;
let scriptPath: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-stale-steer-ws-"));
  scriptPath = join(workspaceDir, "script.json");
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  const cleanupId = 994_001;
  harness.sendRequest(cleanupId, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: "stale-steer-cleanup",
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(cleanupId).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

async function steerOpenTurn(args: {
  steerError: { code: number; message: string } | null;
  expectedTurnId: string;
  options: Record<string, string | null>;
}) {
  writeFileSync(scriptPath, JSON.stringify({ steerError: args.steerError }));
  stubFakeCodexAppServer(scriptPath);
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse((await harness.waitForResponse(1)).result);
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_trnstart23",
    input: [{ type: "text", text: "/wait-for-interrupt", mentions: [] }],
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  expect((await harness.waitForResponse(2)).error).toBeUndefined();
  harness.sendRequest(3, "turn/steer", {
    threadId: THREAD_ID,
    providerThreadId,
    expectedTurnId: args.expectedTurnId,
    clientRequestId: "creq_trnsteer23",
    input: [{ type: "text", text: "one more thing", mentions: [] }],
    options: args.options,
  });
  return (await harness.waitForResponse(3)).error;
}

it.each([
  "no active turn to steer",
  "expected active turn id `turn-fx-1` but found `turn-fx-2`",
])(
  "reports Codex's %j steer rejection as a stale turn",
  async (message) => {
    expect(
      await steerOpenTurn({
        steerError: { code: -32600, message },
        expectedTurnId: "turn-fx-1",
        options: { ...FULL_ACCESS_SESSION_OPTIONS },
      }),
    ).toEqual({
      code: NO_ACTIVE_TURN,
      message,
      data: { recovery: { kind: "staleTurn", message, retryable: false } },
    });
  },
  30_000,
);

it("keeps other Codex steer rejections as bridge errors", async () => {
  const message = "cannot steer a review turn";
  expect(
    await steerOpenTurn({
      steerError: { code: -32600, message },
      expectedTurnId: "turn-fx-1",
      options: { ...FULL_ACCESS_SESSION_OPTIONS },
    }),
  ).toEqual({ code: BRIDGE_ERROR, message });
}, 30_000);

it("reports a permission-changing steer for a turn that already ended as a stale turn", async () => {
  const message = "The turn to steer is no longer active";
  expect(
    await steerOpenTurn({
      steerError: null,
      expectedTurnId: "turn-fx-ended",
      options: {
        permissionMode: "auto",
        permissionScope: "workspace",
        approvalReviewer: "automatic",
        permissionEscalation: "ask",
      },
    }),
  ).toEqual({
    code: NO_ACTIVE_TURN,
    message,
    data: { recovery: { kind: "staleTurn", message, retryable: false } },
  });
}, 30_000);
