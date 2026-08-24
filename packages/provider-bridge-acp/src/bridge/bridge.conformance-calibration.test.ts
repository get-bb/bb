import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  formatConformanceReport,
  runBridgeConformance,
} from "@bb/provider-bridge-protocol/conformance";
import { captureBridgeJsonRpcOutput } from "@bb/provider-bridge-protocol/testing";
import type { CapturedBridgeJsonRpcOutput } from "@bb/provider-bridge-protocol/testing";

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

let output: CapturedBridgeJsonRpcOutput;
let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-acp-conformance-"));
  output = captureBridgeJsonRpcOutput();
});

afterEach(() => {
  // The kit releases its session at the end of the run, so no fake-agent
  // subprocess outlives the test.
  output.restore();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("passes the canonical protocol suite against the fake agent", async () => {
  const report = await runBridgeConformance({
    transport: { send: handleLine, takeMessages: output.takeMessages },
    providerId: "acp",
    session: {
      cwd: workspaceDir,
      promptInput: [{ type: "text", text: "say hello", mentions: [] }],
      // The fake agent treats this exact prompt as a provider-local control
      // (OpenCode does the same): it answers `stopReason: end_turn` without a
      // single session/update, so the turn carries no activity at all.
      zeroWorkPromptInput: [{ type: "text", text: "/compact", mentions: [] }],
      // The fake agent keeps this prompt pending until session/cancel, so
      // the interrupt rules run: a held turn must not block another thread,
      // and thread/stop {interrupt} must settle it before it is answered.
      interruptiblePromptInput: [{ type: "text", text: "hang", mentions: [] }],
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
            // The bridge's handshake declares `fork: "tip"`, so the kit forks
            // the lifecycle session; the fake agent advertises and accepts
            // `session/fork` the way the agents declared with fork do.
            env: { FAKE_ACP_FORK_SESSION: "1" },
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
    "session/resume-identity": "pass",
    "session/resume-id-uniqueness": "pass",
    "session/fork-identity": "pass",
    "turn/settles-without-activity": "pass",
    "session/threads-independent": "pass",
    "stop/interrupt-settles-before-result": "pass",
  });

  expect(report.passed).toBe(true);
}, 60_000);
