import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  experimental_captureBridgeJsonRpcOutput as captureBridgeJsonRpcOutput,
  experimental_formatConformanceReport as formatConformanceReport,
  experimental_runBridgeConformance as runBridgeConformance,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import type {
  CapturedBridgeJsonRpcOutput,
  ConformanceAgentObservation,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import { z } from "zod";

import { handleLine } from "./bridge.js";
import { stubFakeCodexAppServer } from "./fake-codex-app-server-harness.js";

let output: CapturedBridgeJsonRpcOutput;
let workspaceDir: string;
let observationLogPath: string;

const fakeObservationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("launch"),
    pid: z.number(),
    env: z.record(z.string(), z.string()),
  }),
  z.object({
    kind: z.literal("thread"),
    pid: z.number(),
    codexThreadId: z.string(),
    dynamicTools: z.array(
      z.object({ name: z.string(), description: z.string() }).passthrough(),
    ),
  }),
  z.object({
    kind: z.literal("resume"),
    pid: z.number(),
    codexThreadId: z.string(),
  }),
  z.object({
    kind: z.literal("extraRoots"),
    pid: z.number(),
    extraRoots: z.array(z.string()),
  }),
]);

function observeFakeAppServer(
  providerThreadId: string,
): ConformanceAgentObservation | null {
  if (!existsSync(observationLogPath)) return null;
  const records = readFileSync(observationLogPath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => fakeObservationSchema.parse(JSON.parse(line)));
  const serving = records.slice().reverse().find(
    (record) =>
      (record.kind === "thread" || record.kind === "resume") &&
      record.codexThreadId === providerThreadId,
  );
  const started = records.find(
    (record) =>
      record.kind === "thread" && record.codexThreadId === providerThreadId,
  );
  const launch = records.find(
    (record) => record.kind === "launch" && record.pid === serving?.pid,
  );
  if (serving === undefined || started?.kind !== "thread") return null;
  const extraRoots = records
    .slice()
    .reverse()
    .find(
      (record) => record.kind === "extraRoots" && record.pid === serving.pid,
    );
  return {
    env: launch?.kind === "launch" ? launch.env : {},
    skills:
      extraRoots?.kind === "extraRoots"
        ? extraRoots.extraRoots.flatMap((root) =>
            existsSync(root) ? readdirSync(root) : [],
          )
        : [],
    tools: started.dynamicTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
  };
}

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-conformance-ws-"));
  const fakeScriptPath = join(workspaceDir, "fake-codex-script.json");
  observationLogPath = join(workspaceDir, "fake-codex-observations.jsonl");
  writeFileSync(
    fakeScriptPath,
    JSON.stringify({
      archiveStatePath: join(workspaceDir, "fake-codex-archived.json"),
      observationLogPath,
    }),
  );
  stubFakeCodexAppServer(fakeScriptPath);
  output = captureBridgeJsonRpcOutput();
});

afterEach(() => {
  output.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("passes the canonical protocol suite against supervised fake app-server children", async () => {
  const report = await runBridgeConformance({
    transport: { send: handleLine, takeMessages: output.takeMessages },
    providerId: "codex",
    session: {
      cwd: workspaceDir,
      promptInput: [{ type: "text", text: "say hello", mentions: [] }],
      zeroWorkPromptInput: [{ type: "text", text: "/clear", mentions: [] }],
      interruptiblePromptInput: [
        { type: "text", text: "/wait-for-interrupt", mentions: [] },
      ],
      probe: {
        observe: ({ providerThreadId }) =>
          observeFakeAppServer(providerThreadId),
      },
    },
    timeoutMs: 10_000,
  });

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
    "skills/configure-declared": "pass",
    "commands/list-declared": "pass",
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
    "turn/settles-without-activity": "pass",
    "recovery/session-archived": "pass",
    "session/threads-independent": "pass",
    "stop/interrupt-settles-before-result": "pass",
    "config/skills-per-session": "pass",
    "config/skills-change-isolated": "pass",
    "config/env-reaches-agent": "pass",
    "config/tools-at-start": "pass",
    "config/tools-added-after-empty-start": "skipped",
    "config/tools-change-applies": "skipped",
    "config/tools-removed": "skipped",
  });

  expect(
    report.results
      .filter((result) => result.status !== "pass")
      .map((result) => result.id),
  ).toEqual([
    "config/tools-added-after-empty-start",
    "config/tools-change-applies",
    "config/tools-removed",
  ]);
}, 60_000);
