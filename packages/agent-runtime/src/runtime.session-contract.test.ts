import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import {
  createScriptedEchoLaunch,
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
    event.type === "provider/warning" &&
    event.category === "session-settings" &&
    event.summary !== undefined
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

  it("tells the user to stop the thread after the open-work check keeps failing, and stopping applies the change", async () => {
    const { events, record, runtime } = createRuntime({
      process: { sessionSettings: { model: { apply: "resume" } } },
      thread: {
        failMethods: [{ method: "thread/openWork", message: "probe broke" }],
      },
    });
    const { providerThreadId } = await runtime.startThread({
      environmentId: "env-1",
      projectId: "p1",
      providerId: PROVIDER_ID,
      threadId: "t1",
      options: fullRuntimeOptions,
    });
    const changed = { ...fullRuntimeOptions, model: "test-model-2" };
    for (const clientRequestId of [
      "creq_sessctu222",
      "creq_sessctv222",
      "creq_sessctw222",
    ]) {
      await expect(
        runtime.runTurn({
          clientRequestId,
          threadId: "t1",
          input: [promptTextInput({ text: "hello" })],
          options: changed,
        }),
      ).resolves.toEqual({ status: "started" });
      await vi.waitFor(() =>
        expect(runtime.getSessionPhase("t1")).toBe("idle"),
      );
    }

    expect(methods(record)).not.toContain("thread/resume");
    expect(record.last("turn/start")?.params).toMatchObject({
      options: { model: "test-model" },
    });
    const notes = warnings(events).filter((summary) =>
      summary.startsWith("Changed model"),
    );
    expect(notes).toHaveLength(2);
    expect(notes[1]).toContain("stop the thread to apply the change");

    await runtime.stopThread({ threadId: "t1" });
    await runtime.resumeThread({
      environmentId: "env-1",
      projectId: "p1",
      providerId: PROVIDER_ID,
      threadId: "t1",
      providerThreadId,
      options: changed,
    });
    expect(record.last("thread/resume")?.params).toMatchObject({
      options: { model: "test-model-2" },
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

  const acceptEditsOptions = {
    ...fullRuntimeOptions,
    permissionMode: "accept-edits",
    permissionScope: "workspace",
    approvalReviewer: "user",
    permissionEscalation: "deny",
  } as const;

  async function steerIntoRunningTurn(
    contract: ContractRuntime,
    options: Parameters<LaunchBoundAgentRuntime["steerTurn"]>[0]["options"],
    turnOptions: Parameters<
      LaunchBoundAgentRuntime["runTurn"]
    >[0]["options"] = fullRuntimeOptions,
  ) {
    const { events, runtime } = contract;
    await startThread(runtime);
    await runtime.runTurn({
      clientRequestId: "creq_sessctp222",
      threadId: "t1",
      input: [promptTextInput({ text: "delay:500" })],
      options: turnOptions,
    });
    const { turnId } = await waitForThreadTurnStarted({
      events,
      providerId: PROVIDER_ID,
      runtime,
      threadId: "t1",
    });
    const result = await runtime.steerTurn({
      clientRequestId: "creq_sessctq222",
      threadId: "t1",
      expectedTurnId: turnId,
      input: [promptTextInput({ text: "and also this" })],
      options,
    });
    return result;
  }

  it("joins a steer that changes the model to the running turn and applies the change next turn", async () => {
    const contract = createRuntime({});
    const { events, record, runtime } = contract;
    const changed = { ...fullRuntimeOptions, model: "test-model-2" };

    await expect(steerIntoRunningTurn(contract, changed)).resolves.toEqual({
      status: "steered",
    });
    expect(record.last("turn/steer")?.params).toMatchObject({
      options: { model: "test-model" },
    });
    expect(warnings(events)).toContainEqual(
      expect.stringContaining("model applies from the next turn"),
    );

    await waitForThreadTurnCompleted({ events, threadId: "t1" });
    await runtime.runTurn({
      clientRequestId: "creq_sessctr222",
      threadId: "t1",
      input: [promptTextInput({ text: "next" })],
      options: changed,
    });
    expect(record.last("turn/start")?.params).toMatchObject({
      apply: { settings: ["model"] },
      options: { model: "test-model-2" },
    });
  });

  it("joins a steer that raises permissions to the running turn", async () => {
    const contract = createRuntime({});
    await expect(
      steerIntoRunningTurn(contract, fullRuntimeOptions, acceptEditsOptions),
    ).resolves.toEqual({ status: "steered" });
    expect(contract.record.last("turn/steer")?.params).toMatchObject({
      options: { permissionMode: "accept-edits" },
    });
    expect(warnings(contract.events)).toContainEqual(
      expect.stringContaining("permissions applies from the next turn"),
    );
  });

  it("runs a steer that lowers permissions as the next turn", async () => {
    const contract = createRuntime({});
    await expect(
      steerIntoRunningTurn(contract, acceptEditsOptions),
    ).resolves.toMatchObject({ status: "busy" });
    expect(contract.record.read().map((entry) => entry.method)).not.toContain(
      "turn/steer",
    );
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

  it("fails the turn when the settings resume fails and resumes cleanly afterwards", async () => {
    const { record, runtime } = createRuntime({
      process: { sessionSettings: { model: { apply: "resume" } } },
      thread: {
        failMethods: [
          { method: "thread/resume", message: "resume refused", times: 1 },
        ],
      },
    });
    const { providerThreadId } = await runtime.startThread({
      environmentId: "env-1",
      projectId: "p1",
      providerId: PROVIDER_ID,
      threadId: "t1",
      options: fullRuntimeOptions,
    });
    const changed = { ...fullRuntimeOptions, model: "test-model-2" };

    await expect(
      runtime.runTurn({
        clientRequestId: "creq_sessctx222",
        threadId: "t1",
        input: [promptTextInput({ text: "hello" })],
        options: changed,
      }),
    ).rejects.toThrow("resume refused");
    expect(methods(record)).not.toContain("turn/start");
    expect(runtime.getSessionPhase("t1")).toBe("dead");

    await runtime.resumeThread({
      bridgeLaunch: createScriptedEchoLaunch(),
      environmentId: "env-1",
      projectId: "p1",
      providerId: PROVIDER_ID,
      threadId: "t1",
      providerThreadId,
      options: changed,
    });
    await expect(
      runtime.runTurn({
        clientRequestId: "creq_sessctz222",
        threadId: "t1",
        input: [promptTextInput({ text: "hello again" })],
        options: changed,
      }),
    ).resolves.toEqual({ status: "started" });
    expect(record.last("turn/start")?.params).toMatchObject({
      options: { model: "test-model-2" },
    });
  });

  it("carries the turn's live model change into a resume another setting forced", async () => {
    const { events, record, runtime } = createRuntime({});
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
    const before = methods(record).length;

    await runtime.runTurn({
      clientRequestId: "creq_sessctm333",
      threadId: "t1",
      input: [promptTextInput({ text: "hello" })],
      contributedEnv: token("rotated"),
      options: { ...fullRuntimeOptions, model: "test-model-2" },
    });

    expect(methods(record).slice(before)).toEqual([
      "thread/openWork",
      "thread/stop",
      "thread/resume",
      "turn/start",
    ]);
    expect(record.last("thread/resume")?.params).toMatchObject({
      options: { model: "test-model-2", envVars: { GH_TOKEN: "rotated" } },
    });
    expect(record.last("turn/start")?.params).toMatchObject({
      apply: { settings: [], sessionOptions: [], providerOptions: [] },
      options: { model: "test-model-2" },
    });
    expect(
      warnings(events).filter((summary) => summary.startsWith("Applied")),
    ).toEqual([expect.stringMatching(/environment.*model|model.*environment/)]);
  });

  it("keeps the old model on a session it cannot restore and says so once", async () => {
    const { events, record, runtime } = createRuntime({
      process: { sessionSettings: { model: { apply: "resume" } } },
      thread: { sessionRestorable: false },
    });
    await startThread(runtime);
    const changed = { ...fullRuntimeOptions, model: "test-model-2" };

    for (const clientRequestId of ["creq_sessctn333", "creq_sessctp333"]) {
      await runtime.runTurn({
        clientRequestId,
        threadId: "t1",
        input: [promptTextInput({ text: "hello" })],
        options: changed,
      });
      await vi.waitFor(() =>
        expect(runtime.getSessionPhase("t1")).toBe("idle"),
      );
    }

    expect(methods(record)).not.toContain("thread/stop");
    expect(methods(record)).not.toContain("thread/resume");
    const turnStarts = record
      .read()
      .filter((entry) => entry.method === "turn/start");
    expect(turnStarts).toHaveLength(2);
    for (const entry of turnStarts) {
      expect(entry.params).toMatchObject({
        apply: { settings: [] },
        options: { model: "test-model" },
      });
    }
    expect(
      warnings(events).filter((summary) =>
        summary.includes("can't apply to this provider session"),
      ),
    ).toHaveLength(1);
  });
});
