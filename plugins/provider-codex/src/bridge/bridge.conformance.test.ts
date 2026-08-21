import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  experimental_captureBridgeJsonRpcOutput as captureBridgeJsonRpcOutput,
  experimental_createBridgeDeltaEventCollector as createBridgeDeltaEventCollector,
  experimental_formatConformanceReport as formatConformanceReport,
  experimental_runBridgeConformance as runBridgeConformance,
  experimental_toConformanceMessages as toConformanceMessages,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import type {
  BridgeConformanceTransport,
  CapturedBridgeJsonRpcOutput,
} from "@get-bb/plugin-sdk/provider-bridge/testing";

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

const CONFORMANCE_THREAD_ID = "thr_conformance_1";

const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);

let output: CapturedBridgeJsonRpcOutput;
let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-conformance-ws-"));
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify([fakeAppServerPath]),
  );
  output = captureBridgeJsonRpcOutput();
});

afterEach(async () => {
  // Release the session the kit leaves behind (its last scenario resumes and
  // runs a turn) so no fake app-server child outlives the test.
  const cleanupId = 990_001;
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: cleanupId,
      method: "thread/stop",
      params: {
        threadId: CONFORMANCE_THREAD_ID,
        providerThreadId: "conformance-cleanup",
        intent: "release",
        activeTurnId: null,
      },
    }),
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (output.messages.some((message) => message.id === cleanupId)) {
      break;
    }
    await new Promise((resolveTick) => setTimeout(resolveTick, 20));
  }
  output.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("passes the canonical protocol suite against supervised fake app-server children", async () => {
  let drained = 0;
  // The conformance kit's grammar checks run over canonical ThreadEvents;
  // the codex bridge emits thread/delta. Run deltas through a real assembler
  // (the runtime adapter's exact translation, held stateful across the whole
  // run) and hand the kit its assembled-event notifications.
  const collector = createBridgeDeltaEventCollector("codex");
  const transport: BridgeConformanceTransport = {
    send: (line) => handleLine(line),
    takeMessages: () => {
      const fresh = output.messages.slice(drained);
      drained = output.messages.length;
      return fresh.flatMap((message) =>
        toConformanceMessages(message, collector),
      );
    },
  };

  const report = await runBridgeConformance({
    transport,
    session: {
      cwd: workspaceDir,
      promptInput: [{ type: "text", text: "say hello", mentions: [] }],
      // The fake app-server accepts this prompt and answers with no
      // turn/started and no turn/completed at all; only the bridge's
      // dispatch-owned settlement can close the bb turn.
      zeroWorkPromptInput: [{ type: "text", text: "/clear", mentions: [] }],
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
    "session/start-identity": "pass",
    "turn/lifecycle": "pass",
    "events/schema-valid": "pass",
    "item/opens-before-delta": "pass",
    "stop/release-not-interrupted": "pass",
    "session/resume-id-uniqueness": "pass",
    "turn/settles-without-activity": "pass",
  });

  // Stronger than `report.passed`: no rule may be non-green, not even skipped.
  expect(
    report.results
      .filter((result) => result.status !== "pass")
      .map((result) => result.id),
  ).toEqual([]);
}, 60_000);
