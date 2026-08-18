/**
 * The echo bridge's conformance run: drives the bridge in-process through the
 * canonical Provider Bridge Protocol suite (JSON-RPC hygiene, the initialize
 * handshake, and the shared session lifecycle) and asserts a fully green
 * report. This is the test every provider bridge should ship — a conformant
 * bridge passes all eleven scenarios.
 *
 * The transport is the in-process pattern: `send` is the bridge's exported
 * line handler, and `takeMessages` drains a captured stdout buffer (the
 * bridge writes protocol lines with process.stdout.write).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  formatConformanceReport,
  runBridgeConformance,
  type BridgeConformanceTransport,
} from "@bb/provider-bridge-protocol/conformance";
import { handleLine } from "./src/provider-bridge.js";

interface CapturedStdout {
  messages: unknown[];
  restore: () => void;
}

/** Buffer every protocol line the bridge writes to stdout. */
function captureStdoutJsonLines(): CapturedStdout {
  const messages: unknown[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  let pending = "";
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    pending += typeof chunk === "string" ? chunk : chunk.toString();
    for (;;) {
      const newlineIndex = pending.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }
      const line = pending.slice(0, newlineIndex);
      pending = pending.slice(newlineIndex + 1);
      if (line.trim().length === 0) {
        continue;
      }
      messages.push(JSON.parse(line));
    }
    return true;
  }) as typeof process.stdout.write;
  return {
    messages,
    restore: () => {
      process.stdout.write = originalWrite;
    },
  };
}

let output: CapturedStdout;
let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-echo-conformance-"));
  output = captureStdoutJsonLines();
});

afterEach(() => {
  output.restore();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("passes the canonical protocol suite", async () => {
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
    "session/resume-id-uniqueness": "pass",
  });
  expect(report.passed).toBe(true);
}, 30_000);
