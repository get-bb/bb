import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

const INHERITED_HOME = "/tmp/bb-codex-home-inherited";
const PERSONAL_HOME = "/tmp/bb-codex-home-personal";
const WORK_HOME = "/tmp/bb-codex-home-work";

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workDir: string;
let launchLogPath: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "bb-codex-home-"));
  launchLogPath = join(workDir, "launches.jsonl");
  const scriptPath = join(workDir, "script.json");
  await writeFile(scriptPath, JSON.stringify({ launchLogPath, turns: [] }));
  stubFakeCodexAppServer(scriptPath);
  vi.stubEnv("CODEX_HOME", INHERITED_HOME);
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  experimental_killAllChildrenForTests();
  harness.restore();
  vi.unstubAllEnvs();
  await rm(workDir, { recursive: true, force: true });
});

async function launchedHomes(): Promise<(string | null)[]> {
  const schema = z.object({ codexHome: z.string().nullable() });
  return (await readFile(launchLogPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => schema.parse(JSON.parse(line)).codexHome);
}

function sessionOptions(envVars: Record<string, string>) {
  return { ...FULL_ACCESS_SESSION_OPTIONS, envVars };
}

async function startThread(
  id: number,
  threadId: string,
  envVars: Record<string, string>,
): Promise<string> {
  harness.sendRequest(id, "thread/start", {
    threadId,
    cwd: workDir,
    instructionMode: "append",
    options: sessionOptions(envVars),
  });
  const response = await harness.waitForResponse(id);
  expect(response.error).toBeUndefined();
  return z.object({ providerThreadId: z.string() }).parse(response.result)
    .providerThreadId;
}

it("launches concurrent sessions on their own project CODEX_HOME", async () => {
  await startThread(1, "thr_home_personal", { CODEX_HOME: PERSONAL_HOME });
  await startThread(2, "thr_home_work", { CODEX_HOME: WORK_HOME });
  await startThread(3, "thr_home_default", { PATH: "/usr/bin:/bin" });

  expect(await launchedHomes()).toEqual([
    PERSONAL_HOME,
    WORK_HOME,
    INHERITED_HOME,
  ]);
}, 30_000);

it.each(["resume", "fork"] as const)(
  "launches a %s on the project CODEX_HOME",
  async (kind) => {
    harness.sendRequest(1, `thread/${kind}`, {
      threadId: "thr_home_restore",
      ...(kind === "resume" ? { providerThreadId: "provider-home" } : {}),
      ...(kind === "fork" ? { sourceProviderThreadId: "provider-home" } : {}),
      cwd: workDir,
      instructionMode: "append",
      options: sessionOptions({ CODEX_HOME: WORK_HOME }),
    });
    expect((await harness.waitForResponse(1)).error).toBeUndefined();

    expect(await launchedHomes()).toEqual([WORK_HOME]);
  },
  30_000,
);

it("lists models from the requested CODEX_HOME", async () => {
  harness.sendRequest(1, "model/list", { envVars: { CODEX_HOME: WORK_HOME } });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();
  harness.sendRequest(2, "model/list", { envVars: {} });
  expect((await harness.waitForResponse(2)).error).toBeUndefined();

  expect(await launchedHomes()).toEqual([WORK_HOME, INHERITED_HOME]);
}, 30_000);

it("rebuilds the session on the new home when a turn changes CODEX_HOME", async () => {
  const threadId = "thr_home_change";
  const providerThreadId = await startThread(1, threadId, {
    CODEX_HOME: PERSONAL_HOME,
  });
  const turns = [
    { id: 2, home: PERSONAL_HOME },
    { id: 3, home: WORK_HOME },
  ];
  for (const turn of turns) {
    harness.sendRequest(turn.id, "turn/start", {
      threadId,
      providerThreadId,
      clientRequestId: `creq_hxmechng${turn.id}x`,
      input: [{ type: "text", text: "say hello", mentions: [] }],
      options: sessionOptions({ CODEX_HOME: turn.home }),
    });
    expect((await harness.waitForResponse(turn.id)).error).toBeUndefined();
  }

  expect(await launchedHomes()).toEqual([PERSONAL_HOME, WORK_HOME]);
  expect(
    harness.messages.filter((message) => message.method === "session/replaced"),
  ).toEqual([
    expect.objectContaining({
      params: expect.objectContaining({ threadId, providerThreadId }),
    }),
  ]);
}, 30_000);
