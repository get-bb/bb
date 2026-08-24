import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";

/**
 * Codex's archive and unarchive are not idempotent at the app-server layer:
 * archiving an archived rollout fails with "no rollout found for thread id …"
 * and unarchiving a live one with "no archived rollout found for thread id …".
 * bb's thread/archive and thread/unarchive ask for a final state, so the
 * bridge answers those two failures as success. thread/discard is an archive
 * underneath but keeps its failure: a discard of an unknown rollout stays
 * visible.
 */

const THREAD_ID = "thr_archive_idempotency_1";
const PROVIDER_THREAD_ID = "rollout-archive-idempotency-1";

const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-archive-ws-"));
  // Every maintenance request runs on a fresh app-server child, so the fake's
  // archive state has to outlive one child for it to refuse the duplicate.
  const fakeScriptPath = join(workspaceDir, "fake-codex-script.json");
  writeFileSync(
    fakeScriptPath,
    JSON.stringify({
      archiveStatePath: join(workspaceDir, "fake-codex-archived.json"),
    }),
  );
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify([fakeAppServerPath, fakeScriptPath]),
  );
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(() => {
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

function request(id: number, method: string) {
  harness.sendRequest(id, method, {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
  });
  return harness.waitForResponse(id);
}

it("answers a repeated archive and a repeated unarchive as already done", async () => {
  expect((await request(1, "thread/archive")).result).toEqual({ ok: true });
  expect((await request(2, "thread/archive")).result).toEqual({ ok: true });
  expect((await request(3, "thread/unarchive")).result).toEqual({ ok: true });
  expect((await request(4, "thread/unarchive")).result).toEqual({ ok: true });
}, 30_000);

it("keeps a discard of an already-archived rollout as a failure", async () => {
  expect((await request(1, "thread/archive")).result).toEqual({ ok: true });

  const response = await request(2, "thread/discard");
  expect(response.result).toBeUndefined();
  expect(response.error?.message).toBe(
    `no rollout found for thread id ${PROVIDER_THREAD_ID}`,
  );
}, 30_000);
