import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { z } from "zod";
import { experimental_killAllChildrenForTests, handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

const THREAD_ID = "thr_daybreak_1";

const DAYBREAK_CATALOG = {
  data: [
    {
      id: "gpt-6-astra",
      model: "gpt-6-astra",
      isDefault: true,
      availableAccessPrograms: { cyber: ["standard"] },
    },
    {
      id: "gpt-6-sol",
      model: "gpt-6-sol",
      availableAccessPrograms: { cyber: ["standard", "daybreakBlue"] },
    },
    {
      id: "gpt-6-red",
      model: "gpt-6-red",
      availableAccessPrograms: { cyber: ["standard", "daybreakRed"] },
    },
    {
      id: "gpt-daybreak-blue-latest",
      model: "gpt-daybreak-blue-latest",
      availableAccessPrograms: { cyber: ["daybreakBlue"] },
    },
  ],
};

const STANDARD_CATALOG = {
  data: [{ id: "gpt-6-astra", model: "gpt-6-astra", isDefault: true }],
};

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;
let requestLogPath: string;
let nextRequestId = 1;
let turnCount = 0;

function useScript(script: Record<string, unknown>): void {
  const scriptPath = join(workspaceDir, "script.json");
  writeFileSync(scriptPath, JSON.stringify({ requestLogPath, ...script }));
  stubFakeCodexAppServer(scriptPath);
}

function childRequests(method: string): Record<string, unknown>[] {
  return readFileSync(requestLogPath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map(
      (line) =>
        JSON.parse(line) as { method: string; params: Record<string, unknown> },
    )
    .filter((entry) => entry.method === method)
    .map((entry) => entry.params);
}

function publishedDaybreakValues(): unknown[] {
  return harness.messages.flatMap((message) => {
    const params = message.params as
      | {
          deltas?: {
            kind: string;
            extensionKind?: string;
            payload?: unknown;
          }[];
        }
      | undefined;
    return (params?.deltas ?? [])
      .filter(
        (delta) =>
          delta.kind === "extension.state" &&
          delta.extensionKind === "bb/session-options",
      )
      .map((delta) => delta.payload);
  });
}

async function request(
  method: string,
  params: Parameters<typeof harness.sendRequest>[2],
) {
  const id = nextRequestId;
  nextRequestId += 1;
  harness.sendRequest(id, method, params);
  const response = await harness.waitForResponse(id);
  expect(response.error).toBeUndefined();
  return response.result;
}

async function startThread(
  sessionOptions?: Record<string, string | boolean>,
): Promise<string> {
  const result = await request("thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: {
      ...FULL_ACCESS_SESSION_OPTIONS,
      ...(sessionOptions === undefined ? {} : { sessionOptions }),
    },
  });
  return z.object({ providerThreadId: z.string() }).parse(result)
    .providerThreadId;
}

async function startTurn(
  providerThreadId: string,
  model: string,
  sessionOptions?: Record<string, string | boolean>,
): Promise<void> {
  await request("turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: `creq_daybreak2${"23456789"[turnCount++ % 8]}`,
    input: [{ type: "text", text: "say hello", mentions: [] }],
    options: {
      ...FULL_ACCESS_SESSION_OPTIONS,
      model,
      ...(sessionOptions === undefined ? {} : { sessionOptions }),
    },
  });
}

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-daybreak-ws-"));
  requestLogPath = join(workspaceDir, "requests.jsonl");
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
  experimental_killAllChildrenForTests();
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("declares the Daybreak switch per model and moves the alias out of the main list", async () => {
  useScript({ modelList: DAYBREAK_CATALOG });

  const result = z
    .object({
      models: z.array(
        z.object({ model: z.string(), sessionOptions: z.unknown() }),
      ),
      selectedOnlyModels: z.array(z.object({ model: z.string() })),
    })
    .parse(await request("model/list", {}));

  expect(
    result.models.map((model) => [model.model, model.sessionOptions]),
  ).toEqual([
    [
      "gpt-6-astra",
      [expect.objectContaining({ id: "daybreak", value: false, fixed: true })],
    ],
    ["gpt-6-sol", [expect.not.objectContaining({ fixed: true })]],
    ["gpt-6-red", [expect.not.objectContaining({ fixed: true })]],
  ]);
  expect(result.selectedOnlyModels.map((model) => model.model)).toEqual([
    "gpt-daybreak-blue-latest",
  ]);
}, 30_000);

it("starts a thread with Daybreak on, asks for the model's Daybreak program each turn, and reports the switch", async () => {
  useScript({ modelList: DAYBREAK_CATALOG });

  const providerThreadId = await startThread({ daybreak: true });
  await startTurn(providerThreadId, "gpt-6-sol", { daybreak: true });
  await startTurn(providerThreadId, "gpt-6-red");
  await startTurn(providerThreadId, "gpt-6-astra");

  expect(childRequests("thread/start")[0]?.daybreakEnabled).toBe(true);
  expect(childRequests("thread/metadata/update")).toEqual([]);
  expect(
    childRequests("turn/start").map((params) => params.cyberAccessProgram),
  ).toEqual(["daybreakBlue", "daybreakRed", undefined]);
  expect(publishedDaybreakValues()).toEqual([
    { options: [expect.objectContaining({ id: "daybreak", value: true })] },
  ]);
}, 30_000);

it("saves a mid-thread change on the Codex thread and asks for the standard program once Daybreak is off", async () => {
  useScript({ modelList: DAYBREAK_CATALOG });

  const providerThreadId = await startThread();
  await startTurn(providerThreadId, "gpt-6-sol");
  await startTurn(providerThreadId, "gpt-6-sol", { daybreak: true });
  await startTurn(providerThreadId, "gpt-6-sol", { daybreak: false });

  expect(childRequests("thread/start")[0]).not.toHaveProperty(
    "daybreakEnabled",
  );
  expect(
    childRequests("thread/metadata/update").map(
      (params) => params.daybreakEnabled,
    ),
  ).toEqual([true, false]);
  expect(
    childRequests("turn/start").map((params) => params.cyberAccessProgram),
  ).toEqual(["standard", "daybreakBlue", "standard"]);
  expect(
    publishedDaybreakValues().map(
      (payload) =>
        (payload as { options: { value: boolean }[] }).options[0]?.value,
    ),
  ).toEqual([false, true, false]);
}, 30_000);

it("still runs the turn with the new choice when Codex cannot save it", async () => {
  useScript({ modelList: DAYBREAK_CATALOG, metadataUpdateError: true });

  const providerThreadId = await startThread();
  await startTurn(providerThreadId, "gpt-6-sol", { daybreak: true });

  expect(
    childRequests("turn/start").map((params) => params.cyberAccessProgram),
  ).toEqual(["daybreakBlue"]);
}, 30_000);

it("restores the choice Codex stored when a thread resumes", async () => {
  useScript({ modelList: DAYBREAK_CATALOG, resumedDaybreakEnabled: true });

  const result = await request("thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: "codex-stored-daybreak",
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse(result);
  await startTurn(providerThreadId, "gpt-6-sol");

  expect(childRequests("thread/metadata/update")).toEqual([]);
  expect(
    childRequests("turn/start").map((params) => params.cyberAccessProgram),
  ).toEqual(["daybreakBlue"]);
  expect(publishedDaybreakValues()).toEqual([
    { options: [expect.objectContaining({ value: true })] },
  ]);
}, 30_000);

it("sends no program and reports no switch for an account without Daybreak", async () => {
  useScript({ modelList: STANDARD_CATALOG });

  const providerThreadId = await startThread({ daybreak: true });
  await startTurn(providerThreadId, "gpt-6-astra", { daybreak: true });

  expect(childRequests("turn/start")[0]).not.toHaveProperty(
    "cyberAccessProgram",
  );
  expect(publishedDaybreakValues()).toEqual([]);
}, 30_000);
