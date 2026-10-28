import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  experimental_formatConformanceReport as formatConformanceReport,
  experimental_runBridgeConformance as runBridgeConformance,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";
import { type FakePiBridgeHarness, startFakePiBridge } from "./test-support.js";

const CONFORMANCE_WAIT_TIMEOUT_MS = 30_000;

let harness: FakePiBridgeHarness;
let observationLogPath: string;

const fakePiObservationSchema = z.object({
  env: z.record(z.string(), z.string()),
  tools: z.array(z.object({ name: z.string(), description: z.string() })),
  skillPaths: z.array(z.string()),
});

function observeFakePi(threadId: string) {
  if (!existsSync(observationLogPath)) return null;
  const record = readFileSync(observationLogPath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => fakePiObservationSchema.parse(JSON.parse(line)))
    .slice()
    .reverse()
    .find((candidate) => candidate.env["BB_THREAD_ID"] === threadId);
  if (record === undefined) return null;
  return {
    env: record.env,
    tools: record.tools,
    skills: record.skillPaths.flatMap((path) =>
      existsSync(path) ? readdirSync(path) : [],
    ),
  };
}

beforeEach(async () => {
  harness = await startFakePiBridge({
    prefix: "bb-pi-conformance-ws-",
    initialize: false,
  });
  observationLogPath = join(harness.workspaceDir, "fake-pi-observations.jsonl");
  vi.stubEnv("FAKE_PI_OBSERVATION_LOG", observationLogPath);
});

afterEach(async () => {
  await harness.teardown();
});

it("passes the canonical protocol suite against a scripted pi rpc child", async () => {
  const report = await runBridgeConformance({
    transport: { send: handleLine, takeMessages: harness.takeMessages },
    providerId: "pi",
    session: {
      cwd: harness.workspaceDir,
      promptInput: [{ type: "text", text: "say hello", mentions: [] }],
      interruptiblePromptInput: [{ type: "text", text: "/hold", mentions: [] }],
      probe: { observe: ({ threadId }) => observeFakePi(threadId) },
    },
    timeoutMs: CONFORMANCE_WAIT_TIMEOUT_MS,
  });

  console.info(`pi bridge conformance:\n${formatConformanceReport(report)}`);

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
    "session/start-identity-announced": "pass",
    "turn/lifecycle": "pass",
    "events/schema-valid": "pass",
    "item/opens-before-delta": "pass",
    "stop/release-not-interrupted": "pass",
    "session/resume-identity": "pass",
    "session/resume-id-uniqueness": "pass",
    "session/fork-identity": "pass",
    "session/fork-identity-announced": "pass",
    "session/threads-independent": "pass",
    "stop/interrupt-settles-before-result": "pass",
    "config/skills-per-session": "pass",
    "config/skills-change-isolated": "pass",
    "config/env-reaches-agent": "pass",
    "config/tools-at-start": "pass",
    "config/tools-added-after-empty-start": "pass",
    "config/tools-change-applies": "pass",
    "config/tools-removed": "pass",
  });
  expect(
    report.results
      .filter((result) => result.status !== "pass")
      .map((r) => r.id),
  ).toEqual([]);
}, 60_000);
