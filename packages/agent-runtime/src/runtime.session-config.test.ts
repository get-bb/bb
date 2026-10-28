import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DynamicTool, ThreadEvent } from "@bb/domain";
import { createAgentRuntime } from "./runtime.js";
import {
  createScriptedEchoLaunch,
  createScriptedEchoProcessLog,
  createScriptedEchoRequestRecord,
  fullRuntimeOptions,
  scriptedEchoProcessEnv,
  waitForThreadAgentMessageText,
  withBridgeLaunch,
  type LaunchBoundAgentRuntime,
  type ScriptedEchoRequestRecord,
} from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";
import type { AgentRuntimeSkillRoot } from "./types.js";

type ApplyMode = "live" | "resume" | "fixed";

function tool(name: string, description: string): DynamicTool {
  return {
    name,
    description,
    inputSchema: { type: "object", properties: {} },
  };
}

const ALPHA = tool("alpha", "first");
const BETA = tool("beta", "second");

describe("session config reconciliation", () => {
  let workspacePath: string;
  const runtimes: LaunchBoundAgentRuntime[] = [];

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), "bb-session-config-"));
  });

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.shutdown()));
    rmSync(workspacePath, { recursive: true, force: true });
  });

  function skillRoot(id: string): AgentRuntimeSkillRoot {
    const path = join(workspacePath, id);
    mkdirSync(path, { recursive: true });
    return { id, path, skills: [] };
  }

  async function startRuntime(args: {
    mode: { dynamicTools: ApplyMode; skills: ApplyMode };
    skillRoots?: AgentRuntimeSkillRoot[];
    sessionSkills?: boolean;
  }): Promise<{
    events: ThreadEvent[];
    processLog: ReturnType<typeof createScriptedEchoProcessLog>;
    record: ScriptedEchoRequestRecord;
    runtime: LaunchBoundAgentRuntime;
    start: (
      threadId: string,
      skillRoots: AgentRuntimeSkillRoot[],
    ) => Promise<void>;
    turn: (text: string, dynamicTools: DynamicTool[]) => Promise<void>;
    turnOn: (
      threadId: string,
      text: string,
      config: {
        dynamicTools?: DynamicTool[];
        skillRoots?: AgentRuntimeSkillRoot[];
      },
    ) => Promise<void>;
  }> {
    const events: ThreadEvent[] = [];
    const record = createScriptedEchoRequestRecord();
    const processLog = createScriptedEchoProcessLog();
    const runtime = withBridgeLaunch(
      createAgentRuntime({
        workspacePath,
        env: {
          ...record.env,
          ...processLog.env,
          ...scriptedEchoProcessEnv({
            sessionConfig: args.mode,
            sessionSkills: args.sessionSkills ?? true,
          }),
        },
        onEvent: (event) => events.push(event),
        onToolCall: async () => ({ contentItems: [], success: true }),
      }),
      createScriptedEchoLaunch({
        scripted: { sessionRestorable: true, uniqueProviderThreadIds: true },
      }),
    );
    runtimes.push(runtime);
    const start = async (
      threadId: string,
      skillRoots: AgentRuntimeSkillRoot[],
    ): Promise<void> => {
      await runtime.startThread({
        environmentId: "env-1",
        projectId: "p1",
        providerId: "fake",
        threadId,
        options: fullRuntimeOptions,
        dynamicTools: [ALPHA],
        skillRoots,
      });
    };
    await start("t1", args.skillRoots ?? []);
    let turnCount = 0;
    const turnOn = async (
      threadId: string,
      text: string,
      config: {
        dynamicTools?: DynamicTool[];
        skillRoots?: AgentRuntimeSkillRoot[];
      },
    ): Promise<void> => {
      turnCount += 1;
      await runtime.runTurn({
        clientRequestId: `creq_sessncfg${"abcdefghjk"[turnCount]}2`,
        threadId,
        input: [promptTextInput({ text })],
        options: fullRuntimeOptions,
        ...config,
      });
      await waitForThreadAgentMessageText({
        events,
        providerId: "fake",
        runtime,
        text,
        threadId,
      });
    };
    const turn = (text: string, dynamicTools: DynamicTool[]) =>
      turnOn("t1", text, { dynamicTools });
    return { events, processLog, record, runtime, start, turn, turnOn };
  }

  function requests(record: ScriptedEchoRequestRecord, method: string) {
    return record.read().filter((entry) => entry.method === method);
  }

  it("sends a changed tool set on turn/start to a bridge that applies tools live, once", async () => {
    const { record, turn } = await startRuntime({
      mode: { dynamicTools: "live", skills: "resume" },
    });

    await turn("first", [ALPHA, BETA]);
    await turn("second", [ALPHA, BETA]);

    expect(
      requests(record, "turn/start").map((entry) => entry.params?.dynamicTools),
    ).toEqual([[ALPHA, BETA], undefined]);
    expect(requests(record, "thread/resume")).toEqual([]);
  });

  it("resumes the session with the changed tool set before the turn on a resume bridge", async () => {
    const { record, turn } = await startRuntime({
      mode: { dynamicTools: "resume", skills: "resume" },
    });

    await turn("first", [BETA]);
    await turn("second", [BETA]);

    expect(
      requests(record, "thread/resume").map(
        (entry) => entry.params?.dynamicTools,
      ),
    ).toEqual([[BETA]]);
    const methods = record
      .read()
      .map((entry) => entry.method)
      .filter(
        (method) => method === "thread/resume" || method === "turn/start",
      );
    expect(methods).toEqual(["thread/resume", "turn/start", "turn/start"]);
  });

  it("keeps a fixed bridge's start-time tools and warns once", async () => {
    const { events, record, turn } = await startRuntime({
      mode: { dynamicTools: "fixed", skills: "resume" },
    });

    await turn("first", [BETA]);
    await turn("second", [BETA]);

    expect(requests(record, "thread/resume")).toEqual([]);
    expect(
      requests(record, "turn/start").map((entry) => entry.params?.dynamicTools),
    ).toEqual([undefined, undefined]);
    expect(
      events.filter(
        (event) =>
          event.type === "provider/warning" && event.category === "config",
      ),
    ).toHaveLength(1);
  });

  function spawns(processLog: ReturnType<typeof createScriptedEchoProcessLog>) {
    return processLog.read().filter((step) => step.startsWith("spawn:"));
  }

  it("gives each thread on a shared bridge its own skill roots", async () => {
    const rootsA = [skillRoot("a")];
    const rootsB = [skillRoot("b")];
    const { processLog, record, runtime, start } = await startRuntime({
      mode: { dynamicTools: "resume", skills: "live" },
      skillRoots: rootsA,
    });

    await start("t2", rootsB);

    expect(
      requests(record, "thread/start").map((entry) => [
        entry.params?.threadId,
        entry.params?.skillRoots,
      ]),
    ).toEqual([
      ["t1", rootsA],
      ["t2", rootsB],
    ]);
    expect(requests(record, "skills/configure")).toEqual([]);
    expect(spawns(processLog)).toHaveLength(1);
    expect(runtime.listSkillRootsInUse()).toEqual([...rootsA, ...rootsB]);
  });

  it("applies one thread's changed skills live without touching its sibling", async () => {
    const rootsA = [skillRoot("a")];
    const rootsB = [skillRoot("b")];
    const rootsC = [skillRoot("c")];
    const { processLog, record, runtime, start, turnOn } = await startRuntime({
      mode: { dynamicTools: "resume", skills: "live" },
      skillRoots: rootsA,
    });
    await start("t2", rootsB);

    await turnOn("t1", "after skills changed", { skillRoots: rootsC });
    await turnOn("t2", "sibling turn", { skillRoots: rootsB });

    expect(
      requests(record, "turn/start").map((entry) => [
        entry.params?.threadId,
        entry.params?.skillRoots,
      ]),
    ).toEqual([
      ["t1", rootsC],
      ["t2", undefined],
    ]);
    expect(requests(record, "thread/resume")).toEqual([]);
    expect(spawns(processLog)).toHaveLength(1);
    expect(runtime.listSkillRootsInUse()).toEqual([...rootsC, ...rootsB]);
  });

  it("resumes only the thread whose skills changed on a resume bridge", async () => {
    const rootsA = [skillRoot("a")];
    const rootsB = [skillRoot("b")];
    const rootsC = [skillRoot("c")];
    const { processLog, record, start, turnOn } = await startRuntime({
      mode: { dynamicTools: "resume", skills: "resume" },
      skillRoots: rootsA,
    });
    await start("t2", rootsB);

    await turnOn("t1", "after skills changed", { skillRoots: rootsC });
    await turnOn("t2", "sibling turn", { skillRoots: rootsB });

    expect(
      requests(record, "thread/resume").map((entry) => [
        entry.params?.threadId,
        entry.params?.skillRoots,
      ]),
    ).toEqual([["t1", rootsC]]);
    expect(spawns(processLog)).toHaveLength(1);
  });

  it("keeps a bridge without per-session skills on one process per skill catalog", async () => {
    const rootsA = [skillRoot("a")];
    const rootsB = [skillRoot("b")];
    const { processLog, record, runtime, start, turnOn } = await startRuntime({
      mode: { dynamicTools: "resume", skills: "resume" },
      skillRoots: rootsA,
      sessionSkills: false,
    });

    await start("t2", rootsB);
    await turnOn("t1", "moved to the second catalog", { skillRoots: rootsB });

    expect(
      requests(record, "skills/configure").map((entry) => entry.params),
    ).toEqual([{ roots: rootsA }, { roots: rootsB }]);
    expect(
      requests(record, "thread/start").map((entry) => entry.params?.skillRoots),
    ).toEqual([undefined, undefined]);
    expect(spawns(processLog)).toHaveLength(2);
    expect(runtime.listSkillRootsInUse()).toEqual([...rootsB, ...rootsB]);
  });
});
