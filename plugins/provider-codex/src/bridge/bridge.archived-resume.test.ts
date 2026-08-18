import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BRIDGE_JSON_RPC_ERRORS } from "@bb/provider-bridge-protocol";
import { createBridgeJsonRpcTestHarness } from "@bb/provider-bridge-protocol/testing";
import { handleLine } from "./bridge.js";

/**
 * Historical fix a4e3011b0: when the app-server rejects a resume because the
 * codex session is archived, the bridge's error reply must carry the original
 * error text VERBATIM. The runtime's unarchive-and-retry recovery
 * (`CODEX_ARCHIVED_SESSION_ERROR_PATTERN` in `runtime.ts`) matches on that
 * text; rewording or wrapping it silently disables the recovery.
 */

const THREAD_ID = "thr_archived_resume_1";
const ARCHIVED_PROVIDER_THREAD_ID = "archived-prov-1";
// Must match what fake-codex-app-server.mjs emits for `archived-` thread ids.
const ARCHIVED_ERROR_TEXT = `session ${ARCHIVED_PROVIDER_THREAD_ID} is archived; unarchive it and retry`;
// Copy of runtime.ts's CODEX_ARCHIVED_SESSION_ERROR_PATTERN (not exported).
const RUNTIME_UNARCHIVE_RETRY_PATTERN =
  /\b(?:session|thread)\s+\S+\s+is archived\b/i;

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
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-archived-ws-"));
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify([fakeAppServerPath]),
  );
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  const cleanupId = 992_001;
  harness.sendRequest(cleanupId, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: "archived-cleanup",
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(cleanupId).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("preserves the archived-session error text verbatim on a rejected resume", async () => {
  harness.sendRequest(1, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: ARCHIVED_PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...sessionOptions },
  });
  const response = await harness.waitForResponse(1);

  expect(response.result).toBeUndefined();
  expect(response.error?.code).toBe(
    BRIDGE_JSON_RPC_ERRORS.SESSION_NOT_RESTORABLE,
  );
  // Verbatim: any wrapping or rewording breaks the runtime's regex match.
  expect(response.error?.message).toBe(ARCHIVED_ERROR_TEXT);
  expect(response.error?.message).toMatch(RUNTIME_UNARCHIVE_RETRY_PATTERN);
}, 30_000);
