import { Buffer } from "node:buffer";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  type ClientTurnRequestId,
  type PermissionMode,
} from "@bb/domain";
import type { TerminalSession } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDeps } from "../../../src/types.js";
import {
  handleTerminalToolCall,
  TERMINAL_TOOL_NAMES,
} from "../../../src/services/terminals/terminal-tools.js";
import { createTestAppHarness } from "../../helpers/test-app.js";
import {
  seedEvent,
  seedThreadFixture,
  seedThreadRuntimeState,
} from "../../helpers/seed.js";

const TOOL_TURN_ID = "turn_tool";

function makeTerminalSession(overrides: Partial<TerminalSession> = {}) {
  return {
    id: "term_tool",
    threadId: "thr_tool",
    environmentId: "env_tool",
    hostId: "host_tool",
    title: "Tool Terminal",
    initialCwd: "/tmp/workspace",
    cols: 100,
    rows: 30,
    status: "running",
    exitCode: null,
    closeReason: null,
    createdAt: 1,
    updatedAt: 1,
    lastUserInputAt: null,
    ...overrides,
  } satisfies TerminalSession;
}

function firstText(result: Awaited<ReturnType<typeof handleTerminalToolCall>>) {
  const item = result.contentItems[0];
  if (item?.type !== "inputText") {
    throw new Error("Expected inputText tool result");
  }
  return item.text;
}

function requestIdForSequence(value: number): ClientTurnRequestId {
  return encodeClientTurnRequestIdNumber({ value });
}

function seedAcceptedToolTurn(args: {
  deps: Pick<AppDeps, "db" | "hub">;
  environmentId: string | null;
  providerThreadId: string;
  requestId: ClientTurnRequestId;
  sequenceStart: number;
  threadId: string;
  turnId?: string;
}) {
  const turnId = args.turnId ?? TOOL_TURN_ID;
  seedEvent(args.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: args.providerThreadId,
    sequence: args.sequenceStart,
    type: "turn/started",
    scope: turnScope(turnId),
    data: { providerThreadId: args.providerThreadId },
  });
  seedEvent(args.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: args.providerThreadId,
    sequence: args.sequenceStart + 1,
    type: "turn/input/accepted",
    scope: turnScope(turnId),
    data: { clientRequestId: args.requestId },
  });
}

function seedClientTurnRequest(args: {
  deps: Pick<AppDeps, "db" | "hub">;
  environmentId: string | null;
  permissionMode: PermissionMode;
  requestId: ClientTurnRequestId;
  sequence: number;
  threadId: string;
}) {
  seedEvent(args.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    sequence: args.sequence,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      requestId: args.requestId,
      input: [
        {
          type: "text",
          text: "Queued task",
        },
      ],
      target: { kind: "new-turn" },
      execution: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: args.permissionMode,
        source: "client/turn/requested",
      },
      initiator: "user",
      senderThreadId: null,
      request: {
        method: "turn/start",
        params: {},
      },
      source: "tell",
    },
  });
}

async function createToolContext(permissionMode: PermissionMode) {
  const harness = await createTestAppHarness();
  const { environment, thread } = seedThreadFixture(harness);
  const providerThreadId = "provider-thread";
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    permissionMode,
    providerThreadId,
    threadId: thread.id,
  });
  seedAcceptedToolTurn({
    deps: harness.deps,
    environmentId: environment.id,
    providerThreadId,
    requestId: requestIdForSequence(1),
    sequenceStart: 3,
    threadId: thread.id,
  });

  const session = makeTerminalSession({ threadId: thread.id });
  const terminalSessions = harness.deps.terminalSessions;
  vi.spyOn(terminalSessions, "closeThreadTerminal").mockReturnValue(session);
  vi.spyOn(terminalSessions, "createThreadTerminal").mockResolvedValue(session);
  vi.spyOn(terminalSessions, "listThreadTerminals").mockReturnValue([session]);
  vi.spyOn(terminalSessions, "readThreadTerminalOutput").mockResolvedValue({
    chunks: [
      {
        seq: 0,
        dataBase64: Buffer.from("tool-output", "utf8").toString("base64"),
      },
    ],
    nextSeq: 1,
    truncated: true,
  });
  vi.spyOn(terminalSessions, "resizeThreadTerminal").mockReturnValue(
    makeTerminalSession({ ...session, cols: 120, rows: 40 }),
  );
  vi.spyOn(terminalSessions, "sendThreadTerminalInput").mockReturnValue(
    session,
  );

  return {
    deps: harness.deps,
    harness,
    session,
    terminalSessions,
    thread,
  };
}

function callTerminalTool(args: {
  deps: AppDeps;
  threadId: string;
  tool: string;
  toolArgs?: unknown;
  turnId?: string;
}) {
  return handleTerminalToolCall({
    callId: "call_tool",
    deps: args.deps,
    threadId: args.threadId,
    tool: args.tool,
    toolArgs: args.toolArgs,
    turnId: args.turnId ?? TOOL_TURN_ID,
  });
}

describe("terminal agent tools", () => {
  const harnesses: Awaited<ReturnType<typeof createTestAppHarness>>[] = [];

  afterEach(async () => {
    for (const harness of harnesses.splice(0)) {
      await harness.cleanup();
    }
  });

  it("allows read-only list and output tools without full permission", async () => {
    const context = await createToolContext("readonly");
    harnesses.push(context.harness);

    const list = await callTerminalTool({
      deps: context.deps,
      threadId: context.thread.id,
      tool: TERMINAL_TOOL_NAMES.list,
      toolArgs: {},
    });
    const output = await callTerminalTool({
      deps: context.deps,
      threadId: context.thread.id,
      tool: TERMINAL_TOOL_NAMES.output,
      toolArgs: { terminalId: context.session.id },
    });

    expect(list.success).toBe(true);
    expect(JSON.parse(firstText(list))).toEqual({
      sessions: [context.session],
    });
    expect(output.success).toBe(true);
    expect(JSON.parse(firstText(output))).toEqual({
      terminalId: context.session.id,
      nextSeq: 1,
      truncated: true,
      output: "tool-output",
    });
  });

  it("blocks terminal mutation tools without full permission", async () => {
    const context = await createToolContext("workspace-write");
    harnesses.push(context.harness);

    for (const [tool, toolArgs] of [
      [TERMINAL_TOOL_NAMES.start, { command: "sleep 60" }],
      [TERMINAL_TOOL_NAMES.send, { terminalId: context.session.id, text: "q" }],
      [
        TERMINAL_TOOL_NAMES.resize,
        { terminalId: context.session.id, cols: 120, rows: 40 },
      ],
      [TERMINAL_TOOL_NAMES.stop, { terminalId: context.session.id }],
    ] as const) {
      const result = await callTerminalTool({
        deps: context.deps,
        threadId: context.thread.id,
        tool,
        toolArgs,
      });

      expect(result.success).toBe(false);
      expect(firstText(result)).toContain("require full permission mode");
    }

    expect(
      context.terminalSessions.createThreadTerminal,
    ).not.toHaveBeenCalled();
    expect(
      context.terminalSessions.sendThreadTerminalInput,
    ).not.toHaveBeenCalled();
    expect(
      context.terminalSessions.resizeThreadTerminal,
    ).not.toHaveBeenCalled();
    expect(context.terminalSessions.closeThreadTerminal).not.toHaveBeenCalled();
  });

  it("blocks mutation when only a later queued request has full permission", async () => {
    const context = await createToolContext("workspace-write");
    harnesses.push(context.harness);
    seedClientTurnRequest({
      deps: context.deps,
      environmentId: context.thread.environmentId,
      permissionMode: "full",
      requestId: requestIdForSequence(9),
      sequence: 9,
      threadId: context.thread.id,
    });

    const result = await callTerminalTool({
      deps: context.deps,
      threadId: context.thread.id,
      tool: TERMINAL_TOOL_NAMES.start,
      toolArgs: { command: "sleep 60" },
    });

    expect(result.success).toBe(false);
    expect(firstText(result)).toContain("require full permission mode");
    expect(
      context.terminalSessions.createThreadTerminal,
    ).not.toHaveBeenCalled();
  });

  it("allows mutation when the executing turn has full permission despite a later restricted request", async () => {
    const context = await createToolContext("full");
    harnesses.push(context.harness);
    seedClientTurnRequest({
      deps: context.deps,
      environmentId: context.thread.environmentId,
      permissionMode: "workspace-write",
      requestId: requestIdForSequence(9),
      sequence: 9,
      threadId: context.thread.id,
    });

    const result = await callTerminalTool({
      deps: context.deps,
      threadId: context.thread.id,
      tool: TERMINAL_TOOL_NAMES.start,
      toolArgs: { command: "sleep 60" },
    });

    expect(result.success).toBe(true);
    expect(context.terminalSessions.createThreadTerminal).toHaveBeenCalled();
  });

  it("allows terminal mutation tools with full permission", async () => {
    const context = await createToolContext("full");
    harnesses.push(context.harness);

    await expect(
      callTerminalTool({
        deps: context.deps,
        threadId: context.thread.id,
        tool: TERMINAL_TOOL_NAMES.start,
        toolArgs: { command: "sleep 60" },
      }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      callTerminalTool({
        deps: context.deps,
        threadId: context.thread.id,
        tool: TERMINAL_TOOL_NAMES.send,
        toolArgs: { terminalId: context.session.id, text: "q", enter: true },
      }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      callTerminalTool({
        deps: context.deps,
        threadId: context.thread.id,
        tool: TERMINAL_TOOL_NAMES.resize,
        toolArgs: { terminalId: context.session.id, cols: 120, rows: 40 },
      }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      callTerminalTool({
        deps: context.deps,
        threadId: context.thread.id,
        tool: TERMINAL_TOOL_NAMES.stop,
        toolArgs: { terminalId: context.session.id },
      }),
    ).resolves.toMatchObject({ success: true });

    expect(context.terminalSessions.createThreadTerminal).toHaveBeenCalledWith({
      threadId: context.thread.id,
      payload: {
        cols: 100,
        rows: 30,
        title: undefined,
        start: { mode: "command", command: "sleep 60" },
      },
    });
    expect(
      context.terminalSessions.sendThreadTerminalInput,
    ).toHaveBeenCalledWith({
      threadId: context.thread.id,
      terminalId: context.session.id,
      payload: {
        dataBase64: Buffer.from("q\n", "utf8").toString("base64"),
      },
    });
    expect(context.terminalSessions.resizeThreadTerminal).toHaveBeenCalledWith({
      threadId: context.thread.id,
      terminalId: context.session.id,
      payload: { cols: 120, rows: 40 },
    });
    expect(context.terminalSessions.closeThreadTerminal).toHaveBeenCalledWith({
      threadId: context.thread.id,
      terminalId: context.session.id,
      payload: { mode: "force", reason: "user" },
    });
  });

  it("rejects out-of-range terminal dimensions before dispatch", async () => {
    const context = await createToolContext("full");
    harnesses.push(context.harness);

    const result = await callTerminalTool({
      deps: context.deps,
      threadId: context.thread.id,
      tool: TERMINAL_TOOL_NAMES.resize,
      toolArgs: { terminalId: context.session.id, cols: 9999, rows: 40 },
    });

    expect(result.success).toBe(false);
    expect(
      context.terminalSessions.resizeThreadTerminal,
    ).not.toHaveBeenCalled();
  });
});
