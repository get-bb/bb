import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import {
  createScriptedEchoRequestRecord,
  createScriptedEchoRuntime,
  fullRuntimeOptions,
  scriptedEchoProcessEnv,
  waitForThreadTurnCompleted,
  waitForThreadTurnStarted,
  type LaunchBoundAgentRuntime,
  type ScriptedEchoLaunchScript,
} from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

const PROVIDER_ID = "fake";

interface ContractRuntime {
  events: ThreadEvent[];
  record: ReturnType<typeof createScriptedEchoRequestRecord>;
  runtime: LaunchBoundAgentRuntime;
}

function warnings(events: readonly ThreadEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === "provider/warning" && event.summary !== undefined
      ? [event.summary]
      : [],
  );
}

describe("provider session contract", () => {
  let workspacePath: string;
  const runtimes: LaunchBoundAgentRuntime[] = [];

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), "bb-session-contract-"));
  });

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.shutdown()));
    rmSync(workspacePath, { recursive: true, force: true });
  });

  function createRuntime(args: {
    process?: ScriptedEchoLaunchScript;
    thread?: ScriptedEchoLaunchScript;
  }): ContractRuntime {
    const events: ThreadEvent[] = [];
    const record = createScriptedEchoRequestRecord();
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath,
        getProcessEnv: () => ({
          ...record.env,
          ...scriptedEchoProcessEnv(args.process ?? {}),
        }),
        onEvent: (event) => events.push(event),
      },
      launch: { scripted: args.thread ?? {} },
    });
    runtimes.push(runtime);
    return { events, record, runtime };
  }

  async function startThread(runtime: LaunchBoundAgentRuntime): Promise<void> {
    await runtime.startThread({
      environmentId: "env-1",
      projectId: "p1",
      providerId: PROVIDER_ID,
      threadId: "t1",
      options: fullRuntimeOptions,
    });
  }

  function methods(record: ContractRuntime["record"]): string[] {
    return record.read().map((entry) => entry.method);
  }

  it("resumes the session to apply a setting the bridge declares resume", async () => {
    const { events, record, runtime } = createRuntime({
      process: { sessionSettings: { model: { apply: "resume" } } },
    });
    await startThread(runtime);
    const before = methods(record).length;

    await expect(
      runtime.runTurn({
        clientRequestId: "creq_sesscta222",
        threadId: "t1",
        input: [promptTextInput({ text: "on the new model" })],
        options: { ...fullRuntimeOptions, model: "test-model-2" },
      }),
    ).resolves.toEqual({ status: "started" });

    expect(methods(record).slice(before)).toEqual([
      "thread/openWork",
      "thread/stop",
      "thread/resume",
      "turn/start",
    ]);
    expect(record.last("thread/resume")?.params).toMatchObject({
      options: { model: "test-model-2" },
    });
    expect(record.last("turn/start")?.params).toMatchObject({
      apply: { settings: [], sessionOptions: [], providerOptions: [] },
      options: { model: "test-model-2" },
    });
    expect(warnings(events)).toContainEqual(
      expect.stringContaining("Applied model"),
    );
  });

  it("resumes with the new plugin environment when a contribution changes", async () => {
    const { record, runtime } = createRuntime({});
    const token = (value: string) => [
      {
        name: "GH_TOKEN",
        value,
        source: { core: "machine-git" as const },
        reason: "Server gh login",
      },
    ];
    await runtime.startThread({
      environmentId: "env-1",
      projectId: "p1",
      providerId: PROVIDER_ID,
      threadId: "t1",
      contributedEnv: token("first"),
      options: fullRuntimeOptions,
    });

    await runtime.runTurn({
      clientRequestId: "creq_sessctk222",
      threadId: "t1",
      input: [promptTextInput({ text: "hello" })],
      contributedEnv: token("rotated"),
      options: fullRuntimeOptions,
    });

    expect(record.last("thread/resume")?.params).toMatchObject({
      options: { envVars: { GH_TOKEN: "rotated" } },
    });
    expect(record.last("turn/start")?.params).toMatchObject({
      options: { envVars: { GH_TOKEN: "rotated" } },
    });
  });

  it("keeps the running session and reports the change pending while the bridge reports open work", async () => {
    const { events, record, runtime } = createRuntime({
      process: { sessionSettings: { model: { apply: "resume" } } },
      thread: {
        openWork: [
          { id: "bg-1", kind: "terminal", description: "npm run dev" },
        ],
      },
    });
    await startThread(runtime);
    const before = methods(record).length;

    await runtime.runTurn({
      clientRequestId: "creq_sessctb222",
      threadId: "t1",
      input: [promptTextInput({ text: "still on the old model" })],
      options: { ...fullRuntimeOptions, model: "test-model-2" },
    });

    expect(methods(record).slice(before)).toEqual([
      "thread/openWork",
      "turn/start",
    ]);
    expect(record.last("turn/start")?.params).toMatchObject({
      options: { model: "test-model" },
    });
    expect(warnings(events)).toContainEqual(
      expect.stringContaining("npm run dev"),
    );
  });

  it("counts a failed open-work probe as busy", async () => {
    const { record, runtime } = createRuntime({
      process: { sessionSettings: { model: { apply: "resume" } } },
      thread: {
        failMethods: [{ method: "thread/openWork", message: "probe broke" }],
      },
    });
    await startThread(runtime);

    await runtime.runTurn({
      clientRequestId: "creq_sessctc222",
      threadId: "t1",
      input: [promptTextInput({ text: "hello" })],
      options: { ...fullRuntimeOptions, model: "test-model-2" },
    });

    expect(methods(record)).not.toContain("thread/resume");
    expect(record.last("turn/start")?.params).toMatchObject({
      options: { model: "test-model" },
    });
  });

  it("applies a live setting through turn/start.apply without touching the session", async () => {
    const { record, runtime } = createRuntime({});
    await startThread(runtime);
    const before = methods(record).length;

    await runtime.runTurn({
      clientRequestId: "creq_sessctd222",
      threadId: "t1",
      input: [promptTextInput({ text: "hello" })],
      options: { ...fullRuntimeOptions, reasoningLevel: "high" },
    });

    expect(methods(record).slice(before)).toEqual(["turn/start"]);
    expect(record.last("turn/start")?.params).toMatchObject({
      apply: { settings: ["reasoningLevel"] },
      options: { reasoningLevel: "high" },
    });
  });

  it("never applies a fresh setting and says so once", async () => {
    const { events, record, runtime } = createRuntime({});
    await runtime.startThread({
      environmentId: "env-1",
      projectId: "p1",
      providerId: PROVIDER_ID,
      threadId: "t1",
      options: fullRuntimeOptions,
      instructions: "first",
    });
    for (const clientRequestId of ["creq_sesscte222", "creq_sessctf222"]) {
      await runtime.runTurn({
        clientRequestId,
        threadId: "t1",
        input: [promptTextInput({ text: "hello" })],
        options: fullRuntimeOptions,
        instructions: "second",
      });
      await waitForThreadTurnCompleted({ events, threadId: "t1" });
    }

    expect(methods(record)).not.toContain("thread/resume");
    expect(record.last("turn/start")?.params).toMatchObject({
      options: { instructions: "first" },
    });
    expect(
      warnings(events).filter((summary) => summary.includes("instructions")),
    ).toHaveLength(1);
  });

  it("answers a steer busy when it asks for a settings change", async () => {
    const { events, record, runtime } = createRuntime({});
    await startThread(runtime);
    await runtime.runTurn({
      clientRequestId: "creq_sessctg222",
      threadId: "t1",
      input: [promptTextInput({ text: "delay:500" })],
      options: fullRuntimeOptions,
    });
    const { turnId } = await waitForThreadTurnStarted({
      events,
      providerId: PROVIDER_ID,
      runtime,
      threadId: "t1",
    });

    await expect(
      runtime.steerTurn({
        clientRequestId: "creq_sesscth222",
        threadId: "t1",
        expectedTurnId: turnId,
        input: [promptTextInput({ text: "switch to full access" })],
        options: {
          ...fullRuntimeOptions,
          permissionMode: "accept-edits",
          permissionScope: "workspace",
          approvalReviewer: "user",
          permissionEscalation: "deny",
        },
      }),
    ).resolves.toMatchObject({ status: "busy" });
    expect(methods(record)).not.toContain("turn/steer");
  });

  it("still takes steers while a requested change waits on open work", async () => {
    const { events, record, runtime } = createRuntime({
      process: { sessionSettings: { model: { apply: "resume" } } },
      thread: {
        openWork: [{ id: "bg-1", kind: "terminal", description: "watcher" }],
      },
    });
    await startThread(runtime);
    const requested = { ...fullRuntimeOptions, model: "test-model-2" };
    await runtime.runTurn({
      clientRequestId: "creq_sessctm222",
      threadId: "t1",
      input: [promptTextInput({ text: "delay:500" })],
      options: requested,
    });
    const { turnId } = await waitForThreadTurnStarted({
      events,
      providerId: PROVIDER_ID,
      runtime,
      threadId: "t1",
    });

    await expect(
      runtime.steerTurn({
        clientRequestId: "creq_sessctn222",
        threadId: "t1",
        expectedTurnId: turnId,
        input: [promptTextInput({ text: "keep going" })],
        options: requested,
      }),
    ).resolves.toEqual({ status: "steered" });
    expect(record.last("turn/steer")?.params).toMatchObject({
      options: { model: "test-model" },
    });
  });

  it("passes the bridge's busy answer through without starting a turn", async () => {
    const { runtime } = createRuntime({
      thread: { turnStartBusyMessage: "agent is busy" },
    });
    await startThread(runtime);

    await expect(
      runtime.runTurn({
        clientRequestId: "creq_sessctj222",
        threadId: "t1",
        input: [promptTextInput({ text: "hello" })],
        options: fullRuntimeOptions,
      }),
    ).resolves.toEqual({ status: "busy", message: "agent is busy" });
    expect(runtime.getSessionPhase("t1")).toBe("idle");
  });

  it("does not reap an idle session whose bridge reports open work", async () => {
    const { record, runtime } = createRuntime({
      thread: {
        openWork: [{ id: "agent-1", kind: "delegation", description: "x" }],
      },
    });
    await startThread(runtime);

    const result = await runtime.reapIdleProviderSessions({
      idleForMs: 0,
      nowMs: Date.now() + 1_000,
    });

    expect(result.reapedSessions).toEqual([]);
    expect(methods(record)).not.toContain("thread/stop");
  });
});
