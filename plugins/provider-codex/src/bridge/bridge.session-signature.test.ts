import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBridgeJsonRpcTestHarness } from "@bb/provider-bridge-protocol/testing";
import { handleLine } from "./bridge.js";

/**
 * The runtime builds the thread shell environment only for
 * session-construction commands and sends `envVars: {}` on every turn command
 * (`runtime.ts` turn/start and turn/steer). A first turn must therefore keep
 * the session the bridge just constructed: rebuilding it would resume a codex
 * thread whose rollout does not exist yet, which the real app-server rejects
 * with "no rollout found for thread id".
 */

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

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-signature-ws-"));
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify([fakeAppServerPath]),
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
  const providerThreadId = (started.result as { providerThreadId: string })
    .providerThreadId;

  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_signature2",
    input: [{ type: "text", text: "say hello", mentions: [] }],
    // The runtime never carries envVars on a turn.
    options: { ...sessionOptions },
  });
  const turn = await harness.waitForResponse(2);

  expect(turn.error).toBeUndefined();
  expect(
    harness.messages.filter((message) => message.method === "session/replaced"),
  ).toEqual([]);
}, 30_000);
