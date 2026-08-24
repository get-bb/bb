/**
 * The echo bridge's conformance run: drives the bridge in-process through the
 * canonical Provider Bridge Protocol suite (JSON-RPC hygiene, the initialize
 * handshake, the shared session lifecycle, and the zero-work turn) and
 * asserts a fully green report. This is the test every provider bridge
 * should ship — a conformant bridge passes every rule its fixture enables:
 * fourteen here, the twelve every bridge runs plus the zero-work turn and
 * the declared-icon check. Everything it needs comes from the published
 * `@get-bb/plugin-sdk/provider-bridge/testing` kit; no private bb package
 * is involved.
 *
 * The lifecycle scenarios run the bridge's full grammar v3 turn (command,
 * fileRead, search, a delegation with a child turn, planSteps, tools, the
 * extension item and state, the streamed message), so `events/schema-valid`
 * and `item/opens-before-delta` cover every v3 shape the bridge emits.
 *
 * The transport is the in-process pattern: `send` is the bridge's exported
 * line handler, and `takeMessages` drains the captured stdout (the bridge
 * writes protocol lines with process.stdout.write). The bridge emits
 * `thread/delta` notifications; the kit assembles them through the runtime's
 * real delta assembler, so its grammar checks run over the canonical
 * ThreadEvents the runtime would build.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  experimental_captureBridgeJsonRpcOutput as captureBridgeJsonRpcOutput,
  experimental_formatConformanceReport as formatConformanceReport,
  experimental_runBridgeConformance as runBridgeConformance,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import type { CapturedBridgeJsonRpcOutput } from "@get-bb/plugin-sdk/provider-bridge/testing";

import { handleLine } from "./src/provider-bridge.js";
import { ECHO_PLUGIN_ID } from "./src/vocabulary.js";

let output: CapturedBridgeJsonRpcOutput;
let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-echo-conformance-"));
  output = captureBridgeJsonRpcOutput();
});

afterEach(() => {
  output.restore();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("passes the canonical protocol suite", async () => {
  const report = await runBridgeConformance({
    transport: { send: handleLine, takeMessages: output.takeMessages },
    // The kit holds one stateful assembler for the whole run — the runtime
    // adapter's exact delta→event translation, so cross-resume id uniqueness
    // is checked against the ids the runtime would really mint.
    providerId: "echo",
    session: {
      cwd: workspaceDir,
      promptInput: [{ type: "text", text: "say hello", mentions: [] }],
      // `/noop` is the prompt the echo agent completes without activity, so
      // the kit can check that such a turn still settles.
      zeroWorkPromptInput: [{ type: "text", text: "/noop", mentions: [] }],
      // What package.json declares under `bb.branding.experimental_icons`:
      // the receipt row's `echo-provider/receipt` glyph must name one of
      // these, or the server persists the row as provider/unhandled.
      icons: { pluginId: ECHO_PLUGIN_ID, names: ["receipt"] },
    },
    timeoutMs: 5_000,
  });

  // Keep the human-readable report visible for diagnosing any regression.
  output.restore();
  console.info(`echo bridge conformance:\n${formatConformanceReport(report)}`);

  const statusById = Object.fromEntries(
    report.results.map((result) => [result.id, result.status]),
  );
  expect(statusById).toEqual({
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
    "skills/configure-declared": "pass",
    "presentation/icon-namespaced-declared": "pass",
    "turn/settles-without-activity": "pass",
  });
  expect(report.passed).toBe(true);
}, 30_000);
