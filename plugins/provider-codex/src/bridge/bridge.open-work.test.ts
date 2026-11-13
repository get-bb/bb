import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { z } from "zod";
import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  NO_SESSION_SETTINGS_CHANGE,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

const THREAD_ID = "thr_open_work_1";

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;
let scriptPath: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-open-work-ws-"));
  scriptPath = join(workspaceDir, "script.json");
});

afterEach(async () => {
  const cleanupId = 995_001;
  harness.sendRequest(cleanupId, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: "open-work-cleanup",
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(cleanupId).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

async function startThread(script: Record<string, unknown>): Promise<string> {
  writeFileSync(scriptPath, JSON.stringify(script));
  stubFakeCodexAppServer(scriptPath);
  harness = createBridgeJsonRpcTestHarness(handleLine);
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  return z
    .object({ providerThreadId: z.string() })
    .parse((await harness.waitForResponse(1)).result).providerThreadId;
}

async function openWork(id: number, providerThreadId: string) {
  harness.sendRequest(id, "thread/openWork", {
    threadId: THREAD_ID,
    providerThreadId,
  });
  return harness.waitForResponse(id);
}

it("lists every page of Codex background terminals", async () => {
  const providerThreadId = await startThread({
    backgroundTerminalPages: [
      [{ itemId: "exec-1", processId: "101", command: "sleep 90", cwd: "/" }],
      [
        {
          itemId: "exec-2",
          processId: "102",
          command: "npm run dev",
          cwd: "/",
        },
      ],
    ],
  });

  const response = await openWork(2, providerThreadId);

  expect(response.result).toEqual({
    items: [
      {
        id: "101",
        kind: "terminal",
        description: "Codex background terminal is running `sleep 90`",
      },
      {
        id: "102",
        kind: "terminal",
        description: "Codex background terminal is running `npm run dev`",
      },
    ],
  });
});

it("reports nothing open for an idle thread", async () => {
  const providerThreadId = await startThread({});

  expect((await openWork(2, providerThreadId)).result).toEqual({ items: [] });
});

it("reports a Codex sub-agent that keeps running after its parent turn ended", async () => {
  const providerThreadId = await startThread({});
  harness.sendRequest(2, "turn/start", {
    apply: NO_SESSION_SETTINGS_CHANGE,
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_subagent23",
    input: [{ type: "text", text: "/subagent-outlives-turn", mentions: [] }],
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  expect((await harness.waitForResponse(2)).result).toEqual({
    admission: "accepted",
  });

  expect((await openWork(3, providerThreadId)).result).toEqual({
    items: [
      {
        id: "call-fx-1",
        kind: "delegation",
        description: "Codex sub-agent reviewer is running",
      },
    ],
  });
});

it("reports an active Codex Goal as work that starts its own turns", async () => {
  const providerThreadId = await startThread({ initialGoalStatus: "active" });
  await vi.waitFor(() =>
    expect(
      harness.messages.some((message) =>
        JSON.stringify(message.params ?? {}).includes("provider-codex/goal"),
      ),
    ).toBe(true),
  );

  expect((await openWork(2, providerThreadId)).result).toEqual({
    items: [
      {
        id: `goal:${providerThreadId}`,
        kind: "turn",
        description: "Codex keeps starting turns for its active Goal",
      },
    ],
  });
});

it("fails the probe when Codex cannot list background terminals", async () => {
  const providerThreadId = await startThread({
    backgroundTerminalsError: "thread not found",
  });

  const response = await openWork(2, providerThreadId);

  expect(response.result).toBeUndefined();
  expect(response.error).toMatchObject({ message: "thread not found" });
});

it("reports nothing open for a thread without a live Codex session", async () => {
  harness = createBridgeJsonRpcTestHarness(handleLine);

  expect((await openWork(2, "codex-unknown")).result).toEqual({ items: [] });
});
