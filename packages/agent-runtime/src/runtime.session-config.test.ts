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
  waitForRuntimeState,
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
    skillsConfigure?: boolean;
    sessionRestorable?: boolean;
    failResume?: boolean;
    initialThreads?: [string, AgentRuntimeSkillRoot[]][];
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
            ...(args.skillsConfigure === false
              ? { skillsConfigure: false }
              : {}),
            ...(args.failResume === true ? { failResume: true } : {}),
          }),
        },
        onEvent: (event) => events.push(event),
        onToolCall: async () => ({ contentItems: [], success: true }),
      }),
      createScriptedEchoLaunch({
        scripted: {
          sessionRestorable: args.sessionRestorable ?? true,
          uniqueProviderThreadIds: true,
        },
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
    await Promise.all(
      (args.initialThreads ?? [["t1", args.skillRoots ?? []]]).map(
        ([threadId, roots]) => start(threadId, roots),
      ),
    );
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

  function configWarnings(events: ThreadEvent[]) {
    return events.filter(
      (event) =>
        event.type === "provider/warning" && event.category === "config",
    );
  }

  it("keeps a fixed bridge's start-time skills and warns once", async () => {
    const rootsA = [skillRoot("a")];
    const rootsB = [skillRoot("b")];
    const { events, record, turnOn } = await startRuntime({
      mode: { dynamicTools: "resume", skills: "fixed" },
      skillRoots: rootsA,
    });

    await turnOn("t1", "first", { skillRoots: rootsB });
    await turnOn("t1", "second", { skillRoots: rootsB });

    expect(requests(record, "thread/resume")).toEqual([]);
    expect(
      requests(record, "turn/start").map((entry) => entry.params?.skillRoots),
    ).toEqual([undefined, undefined]);
    expect(configWarnings(events)).toHaveLength(1);
  });

  it("keeps an unrestorable session on its catalog's process and warns instead of resuming it", async () => {
    const rootsA = [skillRoot("a")];
    const rootsB = [skillRoot("b")];
    const { events, processLog, record, turnOn } = await startRuntime({
      mode: { dynamicTools: "resume", skills: "resume" },
      skillRoots: rootsA,
      sessionSkills: false,
      sessionRestorable: false,
    });

    await turnOn("t1", "after skills changed", { skillRoots: rootsB });

    expect(requests(record, "thread/stop")).toEqual([]);
    expect(requests(record, "thread/resume")).toEqual([]);
    expect(spawns(processLog)).toHaveLength(1);
    expect(configWarnings(events)).toHaveLength(1);
  });

  it("starts a thread without skills on its own process after one with skills on a bridge without per-session skills", async () => {
    const rootsA = [skillRoot("a")];
    const { processLog, record, start } = await startRuntime({
      mode: { dynamicTools: "resume", skills: "resume" },
      skillRoots: rootsA,
      sessionSkills: false,
    });

    await start("t2", []);

    expect(spawns(processLog)).toHaveLength(2);
    expect(
      requests(record, "skills/configure").map((entry) => entry.params),
    ).toEqual([{ roots: rootsA }]);
  });

  it("gives concurrent starts with different catalogs separate processes on a bridge without per-session skills", async () => {
    const rootsA = [skillRoot("a")];
    const rootsB = [skillRoot("b")];
    const { processLog, record } = await startRuntime({
      mode: { dynamicTools: "resume", skills: "resume" },
      sessionSkills: false,
      initialThreads: [
        ["t1", rootsA],
        ["t2", rootsB],
      ],
    });

    expect(spawns(processLog)).toHaveLength(2);
    expect(
      requests(record, "skills/configure")
        .map((entry) => entry.params)
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        ),
    ).toEqual([{ roots: rootsA }, { roots: rootsB }]);
  });

  it("shares one process between concurrent first starts with different catalogs on a per-session bridge", async () => {
    const rootsA = [skillRoot("a")];
    const rootsB = [skillRoot("b")];
    const { processLog, record } = await startRuntime({
      mode: { dynamicTools: "resume", skills: "resume" },
      initialThreads: [
        ["t1", rootsA],
        ["t2", rootsB],
      ],
    });

    expect(spawns(processLog)).toHaveLength(1);
    expect(requests(record, "skills/configure")).toEqual([]);
    expect(
      requests(record, "thread/start")
        .map((entry) => [entry.params?.threadId, entry.params?.skillRoots])
        .sort(),
    ).toEqual([
      ["t1", rootsA],
      ["t2", rootsB],
    ]);
  });

  it("ignores skill changes on a bridge that cannot configure skills", async () => {
    const rootsA = [skillRoot("a")];
    const rootsB = [skillRoot("b")];
    const { events, processLog, record, start, turnOn } = await startRuntime({
      mode: { dynamicTools: "resume", skills: "resume" },
      skillRoots: rootsA,
      sessionSkills: false,
      skillsConfigure: false,
    });

    await start("t2", rootsB);
    await turnOn("t1", "after skills changed", { skillRoots: rootsB });

    expect(spawns(processLog)).toHaveLength(1);
    expect(requests(record, "skills/configure")).toEqual([]);
    expect(requests(record, "thread/resume")).toEqual([]);
    expect(configWarnings(events)).toEqual([]);
  });

  it("serves sessionless requests on a bridge without per-session skills when the runtime has default skill roots", async () => {
    const roots = [skillRoot("a")];
    const record = createScriptedEchoRequestRecord();
    const runtime = withBridgeLaunch(
      createAgentRuntime({
        workspacePath,
        env: {
          ...record.env,
          ...scriptedEchoProcessEnv({ sessionSkills: false }),
        },
        skillRoots: roots,
        onEvent: () => {},
        onToolCall: async () => ({ contentItems: [], success: true }),
      }),
      createScriptedEchoLaunch(),
    );
    runtimes.push(runtime);

    await runtime.ensureProvider({ providerId: "fake" });

    await expect(runtime.listModels({ providerId: "fake" })).resolves.toEqual(
      expect.objectContaining({ models: expect.any(Array) }),
    );
  });

  it("restores a thread with its own skill roots after a restart recommendation", async () => {
    const rootsA = [skillRoot("a")];
    const { record, runtime } = await startRuntime({
      mode: { dynamicTools: "resume", skills: "resume" },
      skillRoots: rootsA,
    });

    await runtime.runTurn({
      clientRequestId: "creq_sessncfgz2",
      threadId: "t1",
      input: [promptTextInput({ text: "recover:restartRecommended" })],
      options: fullRuntimeOptions,
    });
    await waitForRuntimeState({
      describeFailure: () => JSON.stringify(requests(record, "thread/resume")),
      label: "the thread was resumed after the restart recommendation",
      predicate: () => requests(record, "thread/resume").length === 1,
      runtime,
      timeoutMs: 5_000,
    });

    expect(requests(record, "thread/resume")[0]?.params?.skillRoots).toEqual(
      rootsA,
    );
  });

  it("shuts down every threadless process when moving threads to new catalogs fails", async () => {
    const roots = ["a", "b", "c", "d"].map((id) => [skillRoot(id)]);
    const { processLog, runtime } = await startRuntime({
      mode: { dynamicTools: "resume", skills: "resume" },
      sessionSkills: false,
      failResume: true,
      initialThreads: [
        ["t1", roots[0]!],
        ["t2", roots[1]!],
        ["t3", roots[2]!],
      ],
    });

    for (const threadId of ["t1", "t2", "t3"]) {
      await expect(
        runtime.runTurn({
          clientRequestId: `creq_sessncfg${threadId === "t1" ? "m" : threadId === "t2" ? "n" : "p"}2`,
          threadId,
          input: [promptTextInput({ text: "after skills changed" })],
          options: fullRuntimeOptions,
          skillRoots: roots[3]!,
        }),
      ).rejects.toThrow();
    }

    const livePids = () =>
      spawns(processLog)
        .map((step) => Number(step.slice("spawn:".length)))
        .filter((pid) => {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        });
    await waitForRuntimeState({
      describeFailure: () => `live bridge pids: ${livePids().join(",")}`,
      label: "every threadless bridge process exited",
      predicate: () => livePids().length === 0,
      runtime,
      timeoutMs: 5_000,
    });
  });
});
