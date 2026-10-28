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
  }): Promise<{
    events: ThreadEvent[];
    processLog: ReturnType<typeof createScriptedEchoProcessLog>;
    record: ScriptedEchoRequestRecord;
    runtime: LaunchBoundAgentRuntime;
    turn: (text: string, dynamicTools: DynamicTool[]) => Promise<void>;
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
          ...scriptedEchoProcessEnv({ sessionConfig: args.mode }),
        },
        skillRoots: args.skillRoots ?? [],
        onEvent: (event) => events.push(event),
        onToolCall: async () => ({ contentItems: [], success: true }),
      }),
      createScriptedEchoLaunch({ scripted: { sessionRestorable: true } }),
    );
    runtimes.push(runtime);
    await runtime.startThread({
      environmentId: "env-1",
      projectId: "p1",
      providerId: "fake",
      threadId: "t1",
      options: fullRuntimeOptions,
      dynamicTools: [ALPHA],
    });
    let turnCount = 0;
    const turn = async (
      text: string,
      dynamicTools: DynamicTool[],
    ): Promise<void> => {
      turnCount += 1;
      await runtime.runTurn({
        clientRequestId: `creq_sessncfg${"abcdefghjk"[turnCount]}2`,
        threadId: "t1",
        input: [promptTextInput({ text })],
        options: fullRuntimeOptions,
        dynamicTools,
      });
      await waitForThreadAgentMessageText({
        events,
        providerId: "fake",
        runtime,
        text,
        threadId: "t1",
      });
    };
    return { events, processLog, record, runtime, turn };
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
      .filter((method) => method === "thread/resume" || method === "turn/start");
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

  it("reconfigures skills on the running bridge without replacing its process", async () => {
    const original = skillRoot("original");
    const changed = skillRoot("changed");
    const { processLog, record, runtime, turn } = await startRuntime({
      mode: { dynamicTools: "resume", skills: "live" },
      skillRoots: [original],
    });

    await runtime.configureSkillRoots([changed]);
    await turn("after skills changed", [ALPHA]);

    expect(
      requests(record, "skills/configure").map((entry) => entry.params),
    ).toEqual([{ roots: [original] }, { roots: [changed] }]);
    expect(requests(record, "thread/resume")).toEqual([]);
    expect(
      processLog.read().filter((step) => step.startsWith("spawn:")),
    ).toHaveLength(1);
  });

  it("resumes only the thread's session when skills change on a resume bridge", async () => {
    const original = skillRoot("original");
    const changed = skillRoot("changed");
    const { processLog, record, runtime, turn } = await startRuntime({
      mode: { dynamicTools: "resume", skills: "resume" },
      skillRoots: [original],
    });

    await runtime.configureSkillRoots([changed]);
    await turn("after skills changed", [ALPHA]);
    await turn("again", [ALPHA]);

    expect(requests(record, "thread/resume")).toHaveLength(1);
    expect(
      processLog.read().filter((step) => step.startsWith("spawn:")),
    ).toHaveLength(1);
  });
});
