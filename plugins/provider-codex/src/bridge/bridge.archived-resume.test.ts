import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BRIDGE_JSON_RPC_ERRORS } from "@bb/provider-bridge-protocol";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";

/**
 * When the app-server rejects a resume because the codex session is archived,
 * the bridge's error reply carries the typed `sessionArchived` hint as
 * `error.data.recovery` — that is what drives the runtime's
 * unarchive-and-retry — and the original error text VERBATIM for the
 * user-visible failure when the recovery cannot run (historical fix
 * a4e3011b0 kept the text verbatim for a runtime regex; that regex is gone,
 * the text now only names the session and the CLI command that fixes it).
 */

const THREAD_ID = "thr_archived_resume_1";
const ARCHIVED_PROVIDER_THREAD_ID = "archived-prov-1";
// Must match what fake-codex-app-server.mjs emits for `archived-` thread ids.
const ARCHIVED_ERROR_TEXT = `session ${ARCHIVED_PROVIDER_THREAD_ID} is archived; unarchive it and retry`;

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
  // Verbatim: the text names the session and the CLI command that fixes it.
  expect(response.error?.message).toBe(ARCHIVED_ERROR_TEXT);
  // The typed hint rides the rejection: the runtime acts on this, not text.
  expect(response.error?.data).toEqual({
    recovery: {
      kind: "sessionArchived",
      message: ARCHIVED_ERROR_TEXT,
      retryable: true,
    },
  });
}, 30_000);

it("attaches the sessionArchived hint to a fork whose source is archived", async () => {
  harness.sendRequest(2, "thread/fork", {
    threadId: THREAD_ID,
    sourceProviderThreadId: ARCHIVED_PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...sessionOptions },
  });
  const response = await harness.waitForResponse(2);

  expect(response.result).toBeUndefined();
  // A fork cannot be retried against the same rollout, so it keeps the
  // generic code; the hint names the recovery all the same.
  expect(response.error?.code).toBe(BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR);
  expect(response.error?.data).toMatchObject({
    recovery: { kind: "sessionArchived", retryable: true },
  });
}, 30_000);
