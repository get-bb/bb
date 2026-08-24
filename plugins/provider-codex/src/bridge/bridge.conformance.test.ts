import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  experimental_captureBridgeJsonRpcOutput as captureBridgeJsonRpcOutput,
  experimental_formatConformanceReport as formatConformanceReport,
  experimental_runBridgeConformance as runBridgeConformance,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import type { CapturedBridgeJsonRpcOutput } from "@get-bb/plugin-sdk/provider-bridge/testing";

import { handleLine } from "./bridge.js";

/**
 * The codex bridge's conformance run: drives the bridge through the canonical
 * Provider Bridge Protocol suite against real supervised app-server children
 * — the bridge spawns `fake-codex-app-server.mjs` per session via its
 * app-server command seam, so child spawn, per-child initialize, the
 * notification/request plumbing, and child teardown on release are all
 * exercised for real (not mocked at a module seam).
 *
 * The scripted app-server answers every turn delta-first (an
 * `item/agentMessage/delta` before any `item/started` for that item), so the
 * assembler's item-opening synthesis, central id minting, and cross-resume id
 * uniqueness (the bridge's `session.reset` starts a fresh provider id space
 * per construction) are what the kit verifies.
 *
 * `turn/settles-without-activity` covers the shape codex's native lifecycle
 * does not settle on its own: a prompt the app-server accepts and finishes
 * without emitting `turn/started` (this fixture's zero-work prompt, and the
 * `thread/compact/start` path the bridge dispatches instead of `turn/start`).
 * The bridge settles it from the dispatch it provably owns — the queued
 * turn-start correlation — never from a late signal.
 */

const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);

let output: CapturedBridgeJsonRpcOutput;
let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-conformance-ws-"));
  // The kit's recovery/session-archived rule archives the session (the
  // bridge kills that thread's child) and resumes it on a fresh child, so
  // the fake's archive state has to outlive one child process.
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
  output = captureBridgeJsonRpcOutput();
});

afterEach(() => {
  // The kit releases its session at the end of the run, so no fake
  // app-server child outlives the test.
  output.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("passes the canonical protocol suite against supervised fake app-server children", async () => {
  const report = await runBridgeConformance({
    transport: { send: handleLine, takeMessages: output.takeMessages },
    providerId: "codex",
    session: {
      cwd: workspaceDir,
      promptInput: [{ type: "text", text: "say hello", mentions: [] }],
      // The fake app-server accepts this prompt and answers with no
      // turn/started and no turn/completed at all; only the bridge's
      // dispatch-owned settlement can close the bb turn.
      zeroWorkPromptInput: [{ type: "text", text: "/clear", mentions: [] }],
      // The fake opens a turn for this prompt and never settles it; only an
      // interrupt ends it.
      interruptiblePromptInput: [
        { type: "text", text: "/wait-for-interrupt", mentions: [] },
      ],
    },
    timeoutMs: 10_000,
  });

  // Keep the human-readable report visible in test output for diagnosing
  // any regression.
  console.info(`codex bridge conformance:\n${formatConformanceReport(report)}`);

  const statusById = Object.fromEntries(
    report.results.map((result) => [result.id, result.status]),
  );

  expect(statusById).toMatchObject({
    "rpc/unknown-method": "pass",
    "rpc/invalid-params": "pass",
    "rpc/non-json-ignored": "pass",
    "rpc/response-not-request": "pass",
    "handshake/initialize": "pass",
    "skills/configure-declared": "pass",
    "session/start-identity": "pass",
    "turn/lifecycle": "pass",
    "events/schema-valid": "pass",
    "item/opens-before-delta": "pass",
    "stop/release-not-interrupted": "pass",
    "session/resume-identity": "pass",
    "session/resume-id-uniqueness": "pass",
    "session/fork-identity": "pass",
    "turn/settles-without-activity": "pass",
    "recovery/session-archived": "pass",
    "session/threads-independent": "pass",
    "stop/interrupt-settles-before-result": "pass",
  });

  // Stronger than `report.passed`: no rule may be non-green, not even skipped.
  expect(
    report.results
      .filter((result) => result.status !== "pass")
      .map((result) => result.id),
  ).toEqual([]);
}, 60_000);
