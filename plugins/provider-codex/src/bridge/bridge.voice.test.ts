import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";
import { cleanupBridgeProcessTest } from "./bridge-process.test-support.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

const threadId = "thr_voice_integration";
const providerThreadId = "native-voice-thread";
const sessionId = "11111111-1111-4111-8111-111111111111";
let harness: ReturnType<typeof createHarness> | undefined;
let workspaceDir = "";
let processLogPath = "";

afterEach(async () => {
  await cleanupBridgeProcessTest({
    harness,
    cleanupId: 99,
    threadId,
    providerThreadId,
    processLogPath,
    workspaceDir,
    unstubEnvs: vi.unstubAllEnvs,
  });
  harness = undefined;
});

it("uses the existing native thread and process for voice and translates native coding handoffs", async () => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-voice-bridge-"));
  processLogPath = join(workspaceDir, "process.log");
  const requestLogPath = join(workspaceDir, "requests.ndjson");
  const script = join(workspaceDir, "scenario.json");
  writeFileSync(
    script,
    JSON.stringify({ processLogPath, requestLogPath, voiceStartsTurn: true }),
  );
  stubFakeCodexAppServer(script);
  harness = createHarness(handleLine);
  harness.sendRequest(1, "thread/resume", {
    threadId,
    providerThreadId,
    cwd: workspaceDir,
    instructionMode: "append",
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();
  harness.sendRequest(2, "thread/voice", {
    threadId,
    providerThreadId,
    command: { action: "start", sessionId, sdp: "browser-offer" },
  });
  expect((await harness.waitForResponse(2)).result).toEqual({
    sdp: "native-answer",
  });
  await vi.waitFor(() => {
    const log = JSON.stringify(harness?.messages);
    expect(log).toContain("hello from codex turn 1");
    expect(log).toContain("provider-codex/voice");
  });
  harness.sendRequest(3, "thread/voice", {
    threadId,
    providerThreadId,
    command: { action: "stop", sessionId },
  });
  expect((await harness.waitForResponse(3)).result).toEqual({ sdp: null });
  const requests = readFileSync(requestLogPath, "utf8");
  expect(requests).toContain(
    '"threadId":"native-voice-thread","transport":{"type":"webrtc","sdp":"browser-offer"}',
  );
  expect(requests).not.toContain('"method":"turn/interrupt"');
  expect(requests).not.toContain('"method":"turn/start"');
  expect(
    readFileSync(processLogPath, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("spawn:")),
  ).toHaveLength(1);
}, 15000);

it("rejects an older live app-server before sending unsupported realtime parameters", async () => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-voice-version-"));
  processLogPath = join(workspaceDir, "process.log");
  const requestLogPath = join(workspaceDir, "requests.ndjson");
  const script = join(workspaceDir, "scenario.json");
  writeFileSync(
    script,
    JSON.stringify({
      processLogPath,
      requestLogPath,
      initializeUserAgent: "codex_cli_rs/0.146.0 (test)",
    }),
  );
  stubFakeCodexAppServer(script);
  harness = createHarness(handleLine);
  harness.sendRequest(1, "thread/resume", {
    threadId,
    providerThreadId,
    cwd: workspaceDir,
    instructionMode: "append",
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();
  harness.sendRequest(2, "thread/voice", {
    threadId,
    providerThreadId,
    command: {
      action: "start",
      sessionId,
      sdp: "offer",
      initialContext: "",
      instructions: "guidance",
    },
  });
  expect((await harness.waitForResponse(2)).error?.message).toContain(
    "0.147.0",
  );
  const requests = readFileSync(requestLogPath, "utf8");
  expect(requests).not.toContain("thread/realtime/start");
});
