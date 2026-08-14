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
 * Already flipped by phase 2a: the JSON-RPC hygiene rules (reply, never
 * drop — the calibration's first real finding was that #859 fixed
 * discrimination here but never implemented #853's reply-never-drop). The
 * remaining failures are the canonical surface: as the acp bridge becomes
 * protocol-pure, expectations below flip to "pass" until this file asserts
 * a fully green report and renames itself the acp conformance test.
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
    "rpc/unknown-method": "pass",
    "rpc/invalid-params": "pass",
    "rpc/non-json-ignored": "pass",
    "rpc/response-not-request": "pass",
    "handshake/initialize": "pass",
    // The canonical session surface is not implemented yet — phase 2a
    // flips these.
    "session/start-identity": "fail",
    "turn/lifecycle": "skipped",
    "events/schema-valid": "skipped",
    "item/opens-before-delta": "skipped",
    "stop/release-not-interrupted": "skipped",
    "session/resume-id-uniqueness": "skipped",
  });

  expect(report.passed).toBe(false);
}, 30_000);
