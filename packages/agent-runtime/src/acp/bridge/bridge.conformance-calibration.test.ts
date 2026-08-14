import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  formatConformanceReport,
  runBridgeConformance,
  type BridgeConformanceTransport,
} from "@bb/provider-bridge-protocol/conformance";
import {
  captureBridgeJsonRpcOutput,
  type CapturedBridgeJsonRpcOutput,
} from "../../test/bridge-json-rpc-test-helpers.js";
import { handleLine } from "./bridge.js";

/**
 * Calibration, not conformance: drives the UNMODIFIED acp bridge through the
 * canonical protocol suite and pins the result.
 *
 * The first finding is already in the report: the #859 fix gave this bridge
 * request-vs-response discrimination, but the reply-never-drop rule from #853
 * was never implemented here — `handleParsedMessage` silently returns for an
 * unknown method or schema-invalid request, so the hygiene rules FAIL today.
 * That, plus the whole canonical surface, is the phase-2a migration work
 * list: as the acp bridge becomes protocol-pure, expectations below flip to
 * "pass" until this file asserts a fully green report and renames itself the
 * acp conformance test.
 */

let output: CapturedBridgeJsonRpcOutput;
let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-acp-conformance-"));
  output = captureBridgeJsonRpcOutput();
});

afterEach(() => {
  output.restore();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("pins the canonical-protocol gap list for the unmodified acp bridge", async () => {
  let drained = 0;
  const transport: BridgeConformanceTransport = {
    send: (line) => handleLine(line),
    takeMessages: () => {
      const fresh = output.messages.slice(drained);
      drained = output.messages.length;
      return fresh;
    },
  };

  const report = await runBridgeConformance({
    transport,
    session: {
      cwd: workspaceDir,
      promptInput: [{ type: "text", text: "say hello", mentions: [] }],
    },
    // The canonical scenarios fail fast on this bridge (schema rejections),
    // so a tight timeout only bounds the genuinely unanswered cases.
    timeoutMs: 2_000,
  });

  // Keep the human-readable gap list visible in test output for the
  // phase-2a implementer (and for diagnosing expectation drift).
  console.info(`acp bridge calibration:\n${formatConformanceReport(report)}`);

  const statusById = Object.fromEntries(
    report.results.map((result) => [result.id, result.status]),
  );

  expect(statusById).toMatchObject({
    // Reply-never-drop is NOT implemented in this bridge yet: unknown and
    // schema-invalid requests are silently dropped (handleParsedMessage
    // returns without answering). Phase 2a implements -32601/-32602 replies.
    "rpc/unknown-method": "fail",
    "rpc/invalid-params": "fail",
    // Aliveness cannot be probed on a bridge that drops unknown methods.
    "rpc/non-json-ignored": "skipped",
    "rpc/response-not-request": "skipped",
    // The canonical surface is not implemented yet — phase 2a flips these.
    "handshake/initialize": "fail",
    "session/start-identity": "fail",
    "turn/lifecycle": "skipped",
    "events/schema-valid": "skipped",
    "item/opens-before-delta": "skipped",
    "stop/release-not-interrupted": "skipped",
    "session/resume-id-uniqueness": "skipped",
  });

  expect(report.passed).toBe(false);
}, 30_000);
