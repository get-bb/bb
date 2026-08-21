/**
 * The scripted echo bridge passes the canonical protocol suite exactly like
 * the echo example it extends: the scripted directives add behaviour on top
 * of a conformant bridge, never instead of one.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
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
import { handleLine } from "./src/provider-bridge.js";

let output: CapturedBridgeJsonRpcOutput;
let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-scripted-echo-conformance-"));
  output = captureBridgeJsonRpcOutput();
});

afterEach(() => {
  output.restore();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("passes the canonical protocol suite", async () => {
  let drained = 0;
  const collector = createBridgeDeltaEventCollector("scripted-echo");
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
    },
    timeoutMs: 5_000,
  });

  output.restore();
  console.info(
    `scripted echo bridge conformance:\n${formatConformanceReport(report)}`,
  );
  expect(report.results.filter((result) => result.status !== "pass")).toEqual(
    [],
  );
  expect(report.passed).toBe(true);
}, 30_000);
