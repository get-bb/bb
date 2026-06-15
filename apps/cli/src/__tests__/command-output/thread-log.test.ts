import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  getHelpOutput,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread log command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("bb thread log help describes verbose as expanded timeline output", async () => {
    const helpOutput = await getHelpOutput(["thread", "log"], register);

    expect(helpOutput).toContain("verbose (expanded timeline)");
    expect(helpOutput).not.toContain("verbose (full timeline)");
  });

  it("bb thread log --json prints raw events", async () => {
    const thread = {
      id: "thread-json-log",
      projectId: "proj-1",
      providerId: "provider-1",
      type: "task",
      status: "idle",
      createdAt: 10,
      updatedAt: 20,
    };
    const events = [
      {
        id: "evt-1",
        threadId: "thread-json-log",
        type: "system/error",
        data: { code: "provider_unavailable" },
        createdAt: 20,
        sequence: 2,
      },
    ];
    const getThread = vi.fn(async () => thread);
    const getEvents = vi.fn(async () => events);
    stubServerApi({
      "v1.threads.:id.$get": getThread,
      "v1.threads.:id.events.$get": getEvents,
    });

    await runCommand(["thread", "log", "thread-json-log", "--json"], register);

    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toEqual(events);
  });

  it("bb thread log renders merged timeline rows for human output", async () => {
    const getEvents = vi.fn(async () => []);
    const getTimeline = vi.fn(async () =>
      fixtures.makeTimelineResponse([
        {
          ...fixtures.makeTimelineBase({
            id: "user-1",
            sourceSeqStart: 1,
          }),
          kind: "conversation",
          role: "user",
          text: "Say hello",
          attachments: null,
          mentions: [],
          initiator: "user",
          senderThreadId: null,
          turnRequest: { kind: "message", status: "accepted" },
        },
        {
          ...fixtures.makeTimelineBase({
            id: "op-1",
            sourceSeqStart: 2,
            sourceSeqEnd: 8,
            startedAt: 2,
            createdAt: 8,
          }),
          kind: "system",
          systemKind: "operation",
          operationKind: "thread-provisioning",
          title: "Provisioned thread",
          detail: null,
          status: "completed",
          completedAt: 8,
        },
        {
          ...fixtures.makeTimelineBase({
            id: "assistant-1",
            sourceSeqStart: 9,
          }),
          kind: "conversation",
          role: "assistant",
          text: "Hello!",
          attachments: null,
          turnRequest: null,
        },
      ]),
    );
    stubServerApi({
      "v1.threads.:id.events.$get": getEvents,
      "v1.threads.:id.timeline.feed.$get": getTimeline,
    });

    await runCommand(
      ["thread", "log", "thread-log", "--format", "verbose"],
      register,
    );

    const output = String(vi.mocked(console.log).mock.calls[0]?.[0]);
    expect(output).toContain("Provisioned thread");
    expect(output).not.toContain("Provisioning interrupted");
    expect(getEvents).not.toHaveBeenCalled();
  });

  it("bb thread log renders pending steers for human output", async () => {
    const getEvents = vi.fn(async () => []);
    const getTimeline = vi.fn(async () =>
      fixtures.makeTimelineResponse([fixtures.makePendingSteerTimelineRow()]),
    );
    stubServerApi({
      "v1.threads.:id.events.$get": getEvents,
      "v1.threads.:id.timeline.feed.$get": getTimeline,
    });

    await runCommand(
      ["thread", "log", "thread-log", "--format", "verbose"],
      register,
    );

    const output = String(vi.mocked(console.log).mock.calls[0]?.[0]);
    expect(output).toContain("Please switch to the safer plan");
    expect(output).toContain("steer pending");
    expect(getTimeline).toHaveBeenCalledWith({
      param: { id: "thread-log" },
      query: {},
    });
    expect(getEvents).not.toHaveBeenCalled();
  });

  it("bb thread log renders pending steers with default formatting", async () => {
    const getEvents = vi.fn(async () => []);
    const getTimeline = vi.fn(async () =>
      fixtures.makeTimelineResponse([fixtures.makePendingSteerTimelineRow()]),
    );
    stubServerApi({
      "v1.threads.:id.events.$get": getEvents,
      "v1.threads.:id.timeline.feed.$get": getTimeline,
    });

    await runCommand(["thread", "log", "thread-log"], register);

    const output = String(vi.mocked(console.log).mock.calls[0]?.[0]);
    expect(output).toContain("Please switch to the safer plan");
    expect(output).toContain("steer pending");
    expect(getTimeline).toHaveBeenCalledWith({
      param: { id: "thread-log" },
      query: {},
    });
    expect(getEvents).not.toHaveBeenCalled();
  });

  it("bb thread log renders approval state on command and file-change rows", async () => {
    const getEvents = vi.fn(async () => []);
    const getTimeline = vi.fn(async () =>
      fixtures.makeTimelineResponse([
        {
          ...fixtures.makeTimelineBase({
            id: "command-approval",
            sourceSeqStart: 1,
          }),
          kind: "work",
          workKind: "command",
          status: "pending",
          callId: "cmd-1",
          command: "git push",
          cwd: null,
          source: null,
          output: "",
          exitCode: null,
          completedAt: null,
          approvalStatus: "waiting_for_approval",
          activityIntents: [],
        },
        {
          ...fixtures.makeTimelineBase({
            id: "file-approval",
            sourceSeqStart: 2,
          }),
          kind: "work",
          workKind: "file-change",
          status: "interrupted",
          callId: "file-1",
          change: {
            path: "src/example.ts",
            kind: null,
            movePath: null,
            diff: null,
            diffStats: { added: 0, removed: 0 },
          },
          stdout: null,
          stderr: null,
          approvalStatus: "denied",
        },
      ]),
    );
    stubServerApi({
      "v1.threads.:id.events.$get": getEvents,
      "v1.threads.:id.timeline.feed.$get": getTimeline,
    });

    await runCommand(
      ["thread", "log", "thread-log", "--format", "verbose"],
      register,
    );

    const output = String(vi.mocked(console.log).mock.calls[0]?.[0]);
    expect(output).toContain("Waiting for approval to run git push");
    expect(output).toContain("git push");
    expect(output).toContain("denied");
    expect(output).toContain("example.ts");
    expect(output).not.toContain("Command approval started");
    expect(output).not.toContain("File-change approval started");
    expect(getEvents).not.toHaveBeenCalled();
  });

  it("bb thread log --self resolves from BB_THREAD_ID", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-log-self");
    const getEvents = vi.fn(async () => []);
    const getTimeline = vi.fn(async () => fixtures.makeTimelineResponse([]));
    stubServerApi({
      "v1.threads.:id.events.$get": getEvents,
      "v1.threads.:id.timeline.feed.$get": getTimeline,
    });

    await runCommand(["thread", "log", "--self"], register);

    expect(getEvents).not.toHaveBeenCalled();
    expect(getTimeline).toHaveBeenCalledWith({
      param: { id: "thread-log-self" },
      query: {},
    });
    expect(collectLogLines(vi.mocked(console.error))).toEqual([]);
  });
});
