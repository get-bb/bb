import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import type { ConformanceAgentObservation } from "@bb/provider-bridge-protocol/conformance";
import { dynamicToolSchema } from "@bb/domain";
import { z } from "zod";

import { handleLine } from "./bridge.js";

const FAKE_AGENT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fake-acp-agent.mjs",
);

let output: CapturedBridgeJsonRpcOutput;
let workspaceDir: string;

const fakeSessionObservationSchema = z.object({
  sessionId: z.string(),
  env: z.record(z.string(), z.string()),
  mcpServers: z.array(
    z
      .object({
        env: z
          .array(z.object({ name: z.string(), value: z.string() }))
          .optional(),
      })
      .passthrough(),
  ),
});

const fakePromptObservationSchema = z.object({
  sessionId: z.string(),
  prompt: z.string(),
});

const fakeObservationSchema = z.union([
  fakePromptObservationSchema,
  fakeSessionObservationSchema,
]);

const BB_SKILL_LINE = /^- ([^:]+): .* \(SKILL\.md: /u;

function observeFakeAgent(
  observationLogPath: string,
  providerThreadId: string,
): ConformanceAgentObservation | null {
  if (!existsSync(observationLogPath)) return null;
  const records = readFileSync(observationLogPath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => fakeObservationSchema.parse(JSON.parse(line)))
    .filter((record) => record.sessionId === providerThreadId)
    .reverse();
  const session = records.find((record) => "env" in record);
  if (session === undefined || !("env" in session)) return null;
  const instructed = records.find(
    (record) =>
      "prompt" in record && record.prompt.includes("<system_instructions>"),
  );
  const skills =
    instructed !== undefined && "prompt" in instructed
      ? instructed.prompt.split("\n").flatMap((line) => {
          const match = BB_SKILL_LINE.exec(line);
          return match?.[1] === undefined ? [] : [match[1]];
        })
      : [];
  const tools = session.mcpServers.flatMap((server) => {
    const encoded = server.env?.find(
      (entry) => entry.name === "BB_ACP_DYNAMIC_TOOLS",
    );
    return encoded === undefined
      ? []
      : dynamicToolSchema.array().parse(JSON.parse(encoded.value));
  });
  return {
    env: session.env,
    skills,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
  };
}

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-acp-conformance-"));
  output = captureBridgeJsonRpcOutput();
});

afterEach(() => {
  output.restore();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("passes the canonical protocol suite against the fake agent", async () => {
  const observationLogPath = join(workspaceDir, "fake-acp-observations.jsonl");
  const report = await runBridgeConformance({
    transport: { send: handleLine, takeMessages: output.takeMessages },
    providerId: "acp",
    session: {
      cwd: workspaceDir,
      promptInput: [{ type: "text", text: "say hello", mentions: [] }],
      zeroWorkPromptInput: [{ type: "text", text: "/compact", mentions: [] }],
      interruptiblePromptInput: [{ type: "text", text: "hang", mentions: [] }],
      probe: {
        observe: ({ providerThreadId }) =>
          observeFakeAgent(observationLogPath, providerThreadId),
      },
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
            env: {
              FAKE_ACP_FORK_SESSION: "1",
              FAKE_ACP_LOAD_SESSION: "1",
              FAKE_ACP_OBSERVATION_LOG: observationLogPath,
            },
          },
        },
      },
    },
    timeoutMs: 10_000,
  });

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
    "session/threads-independent": "pass",
    "stop/interrupt-settles-before-result": "pass",
    "config/skills-per-session": "pass",
    "config/skills-change-isolated": "skipped",
    "config/env-reaches-agent": "pass",
    "config/tools-at-start": "pass",
    "config/tools-added-after-empty-start": "pass",
    "config/tools-change-applies": "pass",
    "config/tools-removed": "pass",
  });

  expect(
    report.results
      .filter((result) => result.status !== "pass")
      .map((result) => result.id),
  ).toEqual(["config/skills-change-isolated"]);
}, 60_000);
