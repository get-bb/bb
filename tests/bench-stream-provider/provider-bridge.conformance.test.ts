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
import { BENCH_STREAM_PROVIDER_ID } from "./src/vocabulary.js";

const BENCH_STREAM_PLUGIN_ID = "bench-stream-provider";

let output: CapturedBridgeJsonRpcOutput;
let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-bench-stream-conformance-"));
  output = captureBridgeJsonRpcOutput();
});

afterEach(() => {
  output.restore();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("passes the canonical protocol suite", async () => {
  const report = await runBridgeConformance({
    transport: { send: handleLine, takeMessages: output.takeMessages },
    providerId: BENCH_STREAM_PROVIDER_ID,
    session: {
      cwd: workspaceDir,
      promptInput: [{ type: "text", text: "say hello", mentions: [] }],
      zeroWorkPromptInput: [{ type: "text", text: "bench_noop", mentions: [] }],
      interruptiblePromptInput: [
        {
          type: "text",
          text: "bench_stream doc=long-response chunk=24 interval=5000",
          mentions: [],
        },
      ],
      icons: { pluginId: BENCH_STREAM_PLUGIN_ID, names: [] },
    },
    timeoutMs: 5_000,
  });

  output.restore();
  console.info(
    `bench stream bridge conformance:\n${formatConformanceReport(report)}`,
  );

  const statusById = Object.fromEntries(
    report.results.map((result) => [result.id, result.status]),
  );
  expect(statusById).toEqual({
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
    "recovery/session-archived": "pass",
    "session/threads-independent": "pass",
    "stop/interrupt-settles-before-result": "pass",
    "presentation/icon-namespaced-declared": "pass",
    "turn/settles-without-activity": "pass",
  });
  expect(report.passed).toBe(true);
}, 30_000);
