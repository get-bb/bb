import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { z } from "zod";
import { handleLine } from "./bridge.js";

const THREAD_ID = "thr_signature_1";

const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);

const sessionOptions = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} as const;

const autoAskSessionOptions = {
  permissionMode: "auto",
  permissionScope: "workspace",
  approvalReviewer: "automatic",
  permissionEscalation: "ask",
} as const;

const autoDenySessionOptions = {
  ...autoAskSessionOptions,
  permissionEscalation: "deny",
} as const;

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;
let requestLogPath: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-signature-ws-"));
  requestLogPath = join(workspaceDir, "requests.jsonl");
  const scriptPath = join(workspaceDir, "script.json");
  writeFileSync(scriptPath, JSON.stringify({ requestLogPath }));
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify([fakeAppServerPath, scriptPath]),
  );
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  const cleanupId = 991_001;
  harness.sendRequest(cleanupId, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: "signature-cleanup",
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(cleanupId).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("keeps the constructed session for a turn whose options carry no envVars", async () => {
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...sessionOptions, envVars: { PATH: "/usr/bin:/bin" } },
  });
  const started = await harness.waitForResponse(1);
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse(started.result);

  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_signature2",
    input: [{ type: "text", text: "say hello", mentions: [] }],
    options: { ...sessionOptions },
  });
  const turn = await harness.waitForResponse(2);

  expect(turn.error).toBeUndefined();
  expect(
    harness.messages.filter((message) => message.method === "session/replaced"),
  ).toEqual([]);
}, 30_000);

it("keeps an auto-reviewed session when only escalation intent changes", async () => {
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: autoAskSessionOptions,
  });
  const started = await harness.waitForResponse(1);
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse(started.result);

  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_signature3",
    input: [{ type: "text", text: "say hello", mentions: [] }],
    options: autoDenySessionOptions,
  });
  const turn = await harness.waitForResponse(2);

  expect(turn.error).toBeUndefined();
  expect(
    harness.messages.filter((message) => message.method === "session/replaced"),
  ).toEqual([]);
}, 30_000);

function recordedRequests() {
  const schema = z.object({
    method: z.string(),
    params: z.looseObject({ serviceTier: z.string().nullable().optional() }),
  });
  return readFileSync(requestLogPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => schema.parse(JSON.parse(line)));
}

it("clears Fast for the next turn without replacing the session", async () => {
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...sessionOptions, serviceTier: "fast" },
  });
  const started = await harness.waitForResponse(1);
  expect(started.error).toBeUndefined();
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse(started.result);

  for (const [index, serviceTier] of ["fast", "default", "fast"].entries()) {
    const id = index + 2;
    harness.sendRequest(id, "turn/start", {
      threadId: THREAD_ID,
      providerThreadId,
      clientRequestId: `creq_tiertestx${id}`,
      input: [{ type: "text", text: "say hello", mentions: [] }],
      options: { ...sessionOptions, serviceTier },
    });
    expect((await harness.waitForResponse(id)).error).toBeUndefined();
    expect(recordedRequests().at(-1)).toEqual({
      method: "turn/start",
      params: expect.objectContaining({
        serviceTier: serviceTier === "default" ? null : "fast",
      }),
    });
  }
  expect(
    harness.messages.filter((message) => message.method === "session/replaced"),
  ).toEqual([]);
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
      options: { ...sessionOptions, serviceTier: "default" },
    });
    expect((await harness.waitForResponse(1)).error).toBeUndefined();
    expect(recordedRequests()).toContainEqual({
      method: `thread/${kind}`,
      params: expect.objectContaining({ serviceTier: null }),
    });
  },
  30_000,
);
