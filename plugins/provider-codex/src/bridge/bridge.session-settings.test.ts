import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  bridgeCapabilitiesSchema,
  type JsonValue,
} from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { z } from "zod";
import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  NO_SESSION_SETTINGS_CHANGE,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

const THREAD_ID = "thr_settings_1";

const autoAskSessionOptions = {
  permissionMode: "auto",
  permissionScope: "workspace",
  approvalReviewer: "automatic",
  permissionEscalation: "ask",
} as const;

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;
let requestLogPath: string;
let scriptPath: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-settings-ws-"));
  requestLogPath = join(workspaceDir, "requests.jsonl");
  scriptPath = join(workspaceDir, "script.json");
  writeFileSync(scriptPath, JSON.stringify({ requestLogPath }));
  stubFakeCodexAppServer(scriptPath);
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  const cleanupId = 991_001;
  harness.sendRequest(cleanupId, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: "settings-cleanup",
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(cleanupId).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

function recordedRequests() {
  const schema = z.object({
    method: z.string(),
    params: z.record(z.string(), z.unknown()),
  });
  return readFileSync(requestLogPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => schema.parse(JSON.parse(line)));
}

function lastTurnStartParams() {
  return recordedRequests()
    .filter((request) => request.method === "turn/start")
    .at(-1)?.params;
}

function sessionReplacements() {
  return harness.messages.filter(
    (message) => message.method === "session/replaced",
  );
}

async function startThread(options: Record<string, JsonValue>) {
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options,
  });
  const started = await harness.waitForResponse(1);
  expect(started.error).toBeUndefined();
  return z.object({ providerThreadId: z.string() }).parse(started.result)
    .providerThreadId;
}

async function startTurn(
  providerThreadId: string,
  id: number,
  options: Record<string, JsonValue>,
  input = "say hello",
) {
  harness.sendRequest(id, "turn/start", {
    apply: NO_SESSION_SETTINGS_CHANGE,
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: `creq_settingsx${"23456789"[id % 8]}`,
    input: [{ type: "text", text: input, mentions: [] }],
    options,
  });
  const response = await harness.waitForResponse(id);
  expect(response.error).toBeUndefined();
  expect(response.result).toEqual({ admission: "accepted" });
}

it("declares protocol v3, open-work listing, and how each setting reaches a Codex session", async () => {
  harness.sendRequest(1, "initialize", {
    protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
    client: { name: "test", version: "0.0.0" },
  });
  const response = await harness.waitForResponse(1);
  const result = z
    .object({ protocolVersion: z.number(), capabilities: z.unknown() })
    .parse(response.result);
  const capabilities = bridgeCapabilitiesSchema.parse(result.capabilities);

  expect(result.protocolVersion).toBe(3);
  expect(capabilities.openWork).toEqual({ list: true });
  expect(capabilities.sessionSettings).toMatchObject({
    model: { apply: "live" },
    reasoningLevel: { apply: "live" },
    serviceTier: { apply: "live" },
    permission: { apply: "live" },
    env: { apply: "resume" },
    instructions: { apply: "fresh" },
    dynamicTools: { apply: "fresh" },
    skills: { apply: "resume" },
    sessionOptions: { daybreak: { apply: "live" } },
    providerOptions: {
      memoryEnabled: { apply: "resume" },
      providerSubagentsEnabled: { apply: "resume" },
    },
  });
});

it("never rebuilds the session when a turn carries different construction settings", async () => {
  const providerThreadId = await startThread({
    ...FULL_ACCESS_SESSION_OPTIONS,
    reasoningLevel: "low",
    envVars: { BB_TEST_SECRET: "original" },
    providerOptions: { memoryEnabled: true },
  });

  await startTurn(providerThreadId, 2, {
    ...FULL_ACCESS_SESSION_OPTIONS,
    reasoningLevel: "high",
    envVars: { BB_TEST_SECRET: "rotated" },
    providerOptions: { memoryEnabled: false, providerSubagentsEnabled: false },
  });

  expect(sessionReplacements()).toEqual([]);
  const methods = recordedRequests().map((request) => request.method);
  expect(methods.filter((method) => method === "initialize")).toHaveLength(1);
  expect(methods).not.toContain("thread/resume");
}, 30_000);

it("sends the reasoning level as each turn's effort", async () => {
  const providerThreadId = await startThread({
    ...FULL_ACCESS_SESSION_OPTIONS,
    reasoningLevel: "low",
  });

  for (const [index, reasoningLevel] of ["high", "low", "max"].entries()) {
    await startTurn(providerThreadId, index + 2, {
      ...FULL_ACCESS_SESSION_OPTIONS,
      reasoningLevel,
    });
    expect(lastTurnStartParams()).toMatchObject({ effort: reasoningLevel });
  }
  await startTurn(providerThreadId, 5, { ...FULL_ACCESS_SESSION_OPTIONS });
  expect(lastTurnStartParams()).not.toHaveProperty("effort");
  expect(sessionReplacements()).toEqual([]);
}, 30_000);

it("clears Fast for the next turn without replacing the session", async () => {
  const providerThreadId = await startThread({
    ...FULL_ACCESS_SESSION_OPTIONS,
    serviceTier: "fast",
  });

  for (const [index, serviceTier] of ["fast", "default", "fast"].entries()) {
    await startTurn(providerThreadId, index + 2, {
      ...FULL_ACCESS_SESSION_OPTIONS,
      serviceTier,
    });
    expect(lastTurnStartParams()).toMatchObject({
      serviceTier: serviceTier === "default" ? null : "fast",
    });
  }
  expect(sessionReplacements()).toEqual([]);
}, 30_000);

it.each(["start", "resume", "fork"] as const)(
  "sends an explicit default reset when constructing a %s session",
  async (kind) => {
    harness.sendRequest(1, `thread/${kind}`, {
      threadId: THREAD_ID,
      ...(kind === "resume" ? { providerThreadId: "provider-fast" } : {}),
      ...(kind === "fork" ? { sourceProviderThreadId: "provider-fast" } : {}),
      cwd: workspaceDir,
      instructionMode: "append",
      options: { ...FULL_ACCESS_SESSION_OPTIONS, serviceTier: "default" },
    });
    expect((await harness.waitForResponse(1)).error).toBeUndefined();
    expect(recordedRequests()).toContainEqual({
      method: `thread/${kind}`,
      params: expect.objectContaining({ serviceTier: null }),
    });
  },
  30_000,
);

it("applies permission changes on each turn in both directions without replacing the app-server", async () => {
  const providerThreadId = await startThread(FULL_ACCESS_SESSION_OPTIONS);
  const cases = [
    {
      options: autoAskSessionOptions,
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "workspaceWrite",
    },
    {
      options: FULL_ACCESS_SESSION_OPTIONS,
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "dangerFullAccess",
    },
    {
      options: {
        ...autoAskSessionOptions,
        permissionMode: "accept-edits",
        approvalReviewer: "user",
        permissionEscalation: "deny",
      },
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "workspaceWrite",
    },
  ] as const;
  for (const [index, testCase] of cases.entries()) {
    await startTurn(providerThreadId, index + 2, testCase.options);
    expect(lastTurnStartParams()).toMatchObject({
      approvalPolicy: testCase.approvalPolicy,
      approvalsReviewer: testCase.approvalsReviewer,
      sandboxPolicy: { type: testCase.sandbox },
    });
  }
  expect(sessionReplacements()).toEqual([]);
  expect(
    recordedRequests().filter((request) => request.method === "initialize"),
  ).toHaveLength(1);
}, 30_000);

it("steers the running turn without applying the steer's settings", async () => {
  const providerThreadId = await startThread(FULL_ACCESS_SESSION_OPTIONS);
  await startTurn(
    providerThreadId,
    2,
    FULL_ACCESS_SESSION_OPTIONS,
    "/wait-for-interrupt",
  );

  harness.sendRequest(3, "turn/steer", {
    threadId: THREAD_ID,
    providerThreadId,
    expectedTurnId: "turn-fx-1",
    clientRequestId: "creq_settingsst",
    input: [{ type: "text", text: "one more thing", mentions: [] }],
    options: autoAskSessionOptions,
  });
  const steered = await harness.waitForResponse(3);

  expect(steered.result).toEqual({ admission: "accepted" });
  const methods = recordedRequests().map((request) => request.method);
  expect(methods.filter((method) => method === "turn/steer")).toHaveLength(1);
  expect(methods).not.toContain("turn/interrupt");
  expect(methods.filter((method) => method === "turn/start")).toHaveLength(1);
  expect(sessionReplacements()).toEqual([]);
}, 30_000);
