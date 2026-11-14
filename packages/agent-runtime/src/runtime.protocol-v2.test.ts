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
} from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

const PROVIDER_ID = "fake";

const acceptEditsOptions = {
  ...fullRuntimeOptions,
  permissionMode: "accept-edits",
  permissionScope: "workspace",
  approvalReviewer: "user",
  permissionEscalation: "deny",
} as const;

function token(value: string) {
  return [
    {
      name: "GH_TOKEN",
      value,
      source: { core: "machine-git" as const },
      reason: "Server gh login",
    },
  ];
}

describe("protocol 2 bridges", () => {
  let workspacePath: string;
  const runtimes: LaunchBoundAgentRuntime[] = [];

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), "bb-protocol-v2-"));
  });

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.shutdown()));
    rmSync(workspacePath, { recursive: true, force: true });
  });

  function createRuntime(protocolVersion: 2 | 3) {
    const events: ThreadEvent[] = [];
    const stderr: string[] = [];
    const record = createScriptedEchoRequestRecord();
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath,
        getProcessEnv: () => ({
          ...record.env,
          ...scriptedEchoProcessEnv({ legacyBridge: { protocolVersion } }),
        }),
        onEvent: (event) => events.push(event),
        onStderr: (line) => stderr.push(line),
      },
    });
    runtimes.push(runtime);
    return { events, record, runtime, stderr };
  }

  async function startThread(runtime: LaunchBoundAgentRuntime) {
    await runtime.startThread({
      environmentId: "env-1",
      projectId: "p1",
      providerId: PROVIDER_ID,
      threadId: "t1",
      contributedEnv: token("first"),
      instructions: "be brief",
      options: fullRuntimeOptions,
    });
  }

  function warnings(events: readonly ThreadEvent[]): ThreadEvent[] {
    return events.filter((event) => event.type === "provider/warning");
  }

  it("opens and settles a zero-work turn from a claimIfIdle boundary, as main's assembler did", async () => {
    const { events, runtime } = createRuntime(2);
    await startThread(runtime);

    await expect(
      runtime.runTurn({
        clientRequestId: "creq_prtcv2aa22",
        threadId: "t1",
        input: [promptTextInput({ text: "zero_work" })],
        options: fullRuntimeOptions,
      }),
    ).resolves.toEqual({ status: "started" });
    await waitForThreadTurnCompleted({ events, threadId: "t1" });

    expect(
      events.find((event) => event.type === "turn/completed"),
    ).toMatchObject({ status: "completed" });
    expect(
      events
        .filter((event) => event.threadId === "t1")
        .map((event) => event.type)
        .filter((type) => type.startsWith("turn/")),
    ).toEqual(["turn/started", "turn/input/accepted", "turn/completed"]);
    expect(runtime.getSessionPhase("t1")).toBe("idle");
  });

  it("passes a model or instructions change through the full turn/start options without probing open work or resuming", async () => {
    const { events, record, runtime } = createRuntime(2);
    await startThread(runtime);
    const before = record.read().length;

    await expect(
      runtime.runTurn({
        clientRequestId: "creq_prtcv2bb22",
        threadId: "t1",
        input: [promptTextInput({ text: "hello" })],
        contributedEnv: token("first"),
        instructions: "be thorough",
        options: { ...fullRuntimeOptions, model: "test-model-2" },
      }),
    ).resolves.toEqual({ status: "started" });

    expect(
      record
        .read()
        .slice(before)
        .map((entry) => entry.method),
    ).toEqual(["turn/start"]);
    const params = record.last("turn/start")?.params;
    expect(params).toMatchObject({
      options: {
        model: "test-model-2",
        instructions: "be thorough",
        envVars: { GH_TOKEN: "first" },
      },
    });
    expect(params).not.toHaveProperty("apply");
    expect(warnings(events)).toEqual([]);
  });

  it("resumes the session with a changed environment contribution before the turn, as main's idle restart did", async () => {
    const { events, record, runtime } = createRuntime(2);
    await startThread(runtime);
    const before = record.read().length;

    await expect(
      runtime.runTurn({
        clientRequestId: "creq_prtcv2ff22",
        threadId: "t1",
        input: [promptTextInput({ text: "hello" })],
        contributedEnv: token("rotated"),
        options: fullRuntimeOptions,
      }),
    ).resolves.toEqual({ status: "started" });

    expect(
      record
        .read()
        .slice(before)
        .map((entry) => entry.method),
    ).toEqual(["thread/stop", "thread/resume", "turn/start"]);
    expect(record.last("thread/resume")?.params).toMatchObject({
      options: { envVars: { GH_TOKEN: "rotated" } },
    });
    expect(record.last("turn/start")?.params).toMatchObject({
      options: { envVars: { GH_TOKEN: "rotated" } },
    });
    expect(
      warnings(events).map((event) =>
        event.type === "provider/warning" ? event.summary : undefined,
      ),
    ).toEqual([
      expect.stringMatching(
        /^Restarting the provider session to apply environment\. Background processes/,
      ),
      expect.stringMatching(
        /^Applied environment; the provider session resumed/,
      ),
    ]);
  });

  it("forwards a steer's options, env and instructions, including lowered permissions, as main did", async () => {
    const { events, record, runtime } = createRuntime(2);
    await startThread(runtime);
    await runtime.runTurn({
      clientRequestId: "creq_prtcv2cc22",
      threadId: "t1",
      input: [promptTextInput({ text: "hold_turn" })],
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
        clientRequestId: "creq_prtcv2dd22",
        threadId: "t1",
        expectedTurnId: turnId,
        input: [promptTextInput({ text: "and this" })],
        contributedEnv: token("steered"),
        instructions: "be thorough",
        options: { ...acceptEditsOptions, model: "test-model-2" },
      }),
    ).resolves.toEqual({ status: "steered" });

    expect(record.last("turn/steer")?.params).toMatchObject({
      options: {
        model: "test-model-2",
        permissionMode: "accept-edits",
        instructions: "be thorough",
        envVars: { GH_TOKEN: "steered" },
      },
    });
    expect(warnings(events)).toEqual([]);
  });

  it("runs a bridge that claims protocol 3 without sessionSettings on the protocol 2 path and says so on stderr", async () => {
    const { events, record, runtime, stderr } = createRuntime(3);
    await startThread(runtime);

    await expect(
      runtime.runTurn({
        clientRequestId: "creq_prtcv2ee22",
        threadId: "t1",
        input: [promptTextInput({ text: "zero_work" })],
        options: { ...fullRuntimeOptions, model: "test-model-2" },
      }),
    ).resolves.toEqual({ status: "started" });
    await waitForThreadTurnCompleted({ events, threadId: "t1" });

    expect(stderr).toContainEqual(
      expect.stringContaining(
        "answered initialize with protocol version 3 but without capabilities.sessionSettings",
      ),
    );
    expect(record.read().map((entry) => entry.method)).not.toContain(
      "thread/resume",
    );
    expect(record.last("turn/start")?.params).not.toHaveProperty("apply");
  });
});
