import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { z } from "zod";
import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

const THREAD_ID = "thr_daybreak_1";

function catalogEntry(model: string, cyber: string[]) {
  return {
    id: model,
    model,
    displayName: model,
    description: "",
    supportedReasoningEfforts: [
      { reasoningEffort: "medium", description: "Medium" },
    ],
    defaultReasoningEffort: "medium",
    isDefault: model === "gpt-6-astra",
    availableAccessPrograms: { cyber },
  };
}

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;
let requestLogPath: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-daybreak-ws-"));
  requestLogPath = join(workspaceDir, "requests.jsonl");
  const scriptPath = join(workspaceDir, "script.json");
  writeFileSync(
    scriptPath,
    JSON.stringify({
      requestLogPath,
      modelList: {
        data: [
          catalogEntry("gpt-6-astra", ["standard"]),
          catalogEntry("gpt-6-sol", ["standard", "daybreakBlue"]),
          catalogEntry("gpt-cyber-red", ["daybreakRed"]),
        ],
        nextCursor: null,
      },
    }),
  );
  stubFakeCodexAppServer(scriptPath);
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  const cleanupId = 992_001;
  harness.sendRequest(cleanupId, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: "daybreak-cleanup",
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(cleanupId).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

function turnStartRequests(): Record<string, unknown>[] {
  return readFileSync(requestLogPath, "utf8")
    .trim()
    .split("\n")
    .map((line) =>
      z
        .object({ method: z.string(), params: z.unknown() })
        .parse(JSON.parse(line)),
    )
    .filter((entry) => entry.method === "turn/start")
    .map((entry) => z.record(z.string(), z.unknown()).parse(entry.params));
}

async function startThread(): Promise<string> {
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...FULL_ACCESS_SESSION_OPTIONS, model: "gpt-6-sol" },
  });
  const started = await harness.waitForResponse(1);
  return z.object({ providerThreadId: z.string() }).parse(started.result)
    .providerThreadId;
}

async function sendTurn(args: {
  id: number;
  providerThreadId: string;
  model: string;
  daybreak: boolean;
}) {
  harness.sendRequest(args.id, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId: args.providerThreadId,
    clientRequestId: `creq_daybreakx${args.id}`,
    input: [{ type: "text", text: "audit this", mentions: [] }],
    options: {
      ...FULL_ACCESS_SESSION_OPTIONS,
      model: args.model,
      providerOptions: { daybreak: args.daybreak },
    },
  });
  return harness.waitForResponse(args.id);
}

it("requests the model's Daybreak program only while Daybreak is on", async () => {
  const providerThreadId = await startThread();

  const off = await sendTurn({
    id: 2,
    providerThreadId,
    model: "gpt-6-sol",
    daybreak: false,
  });
  expect(off.error).toBeUndefined();
  const blue = await sendTurn({
    id: 3,
    providerThreadId,
    model: "gpt-6-sol",
    daybreak: true,
  });
  expect(blue.error).toBeUndefined();
  const red = await sendTurn({
    id: 4,
    providerThreadId,
    model: "gpt-cyber-red",
    daybreak: true,
  });
  expect(red.error).toBeUndefined();

  const [offTurn, blueTurn, redTurn] = turnStartRequests();
  expect(offTurn).not.toHaveProperty("cyberAccessProgram");
  expect(blueTurn).toMatchObject({ cyberAccessProgram: "daybreakBlue" });
  expect(redTurn).toMatchObject({ cyberAccessProgram: "daybreakRed" });
});

it("refuses a Daybreak turn on a model without a Daybreak program before reaching Codex", async () => {
  const providerThreadId = await startThread();

  const refused = await sendTurn({
    id: 2,
    providerThreadId,
    model: "gpt-6-astra",
    daybreak: true,
  });

  expect(refused.error?.message).toBe(
    "Daybreak isn't available for gpt-6-astra. Turn off Daybreak or choose another model.",
  );
  expect(turnStartRequests()).toEqual([]);
});
