import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  formatConformanceReport,
  runBridgeConformance,
  type BridgeConformanceTransport,
} from "@bb/provider-bridge-protocol/conformance";
import {
  captureBridgeJsonRpcOutput,
  type CapturedBridgeJsonRpcOutput,
} from "@bb/provider-bridge-protocol/testing";
import {
  createBridgeDeltaEventCollector,
  toConformanceMessages,
} from "@bb/agent-runtime/test/bridge-delta-assembly";
import { handleLine } from "./bridge.js";

/**
 * The acp bridge's conformance run: drives the bridge through the canonical
 * Provider Bridge Protocol suite against the scripted fake agent and asserts
 * a fully green report.
 *
 * History: this file started as a calibration that pinned the gap list of the
 * unmodified bridge. Phase 2a implemented the canonical session surface
 * (per-session dialect, timeline emission through the shared translator,
 * canonical request variants, release-vs-interrupt stop intent), so every
 * scenario now must pass — a regression in any rule is a protocol break.
 *
 * The fake agent does not advertise loadSession, so the resume scenario
 * exercises the fresh-session fallback: the kit tolerates that because turn
 * and item ids carry per-session entropy (unique across resumes) and the
 * post-resume turn works — canonical handlers resolve sessions by bb
 * threadId, not by the stale providerThreadId.
 */

const FAKE_AGENT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fake-acp-agent.mjs",
);

const CONFORMANCE_THREAD_ID = "thr_conformance_1";

let output: CapturedBridgeJsonRpcOutput;
let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-acp-conformance-"));
  output = captureBridgeJsonRpcOutput();
});

afterEach(async () => {
  // Reap the session the kit leaves behind (its last scenario resumes and
  // runs a turn) so the fake-agent subprocess does not outlive the test.
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
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("passes the canonical protocol suite against the fake agent", async () => {
  let drained = 0;
  // The conformance kit's grammar checks run over canonical ThreadEvents;
  // the acp bridge emits thread/delta. Run deltas through a real assembler
  // (the runtime adapter's exact translation, held stateful across the whole
  // run) and hand the kit its assembled-event notifications.
  const collector = createBridgeDeltaEventCollector("acp");
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
      // The fake agent treats this exact prompt as a provider-local control
      // (OpenCode does the same): it answers `stopReason: end_turn` without a
      // single session/update, so the turn carries no activity at all.
      zeroWorkPromptInput: [{ type: "text", text: "/compact", mentions: [] }],
      options: {
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
        providerOptions: {
          acpLaunchSpec: {
            displayName: "Fake ACP Agent",
            command: process.execPath,
            args: [FAKE_AGENT_PATH],
            env: {},
          },
        },
      },
    },
    timeoutMs: 10_000,
  });

  // Keep the human-readable report visible in test output for diagnosing
  // any regression.
  console.info(`acp bridge conformance:\n${formatConformanceReport(report)}`);

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

  expect(report.passed).toBe(true);
}, 60_000);
