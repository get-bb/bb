import { describe, expect, it } from "vitest";
import {
  CURSOR_ACP_DIALECT,
  GENERIC_ACP_DIALECT,
  GROK_ACP_DIALECT,
  resolveAcpDialect,
} from "./dialect.js";
import type { AcpToolCallUpdateEvent } from "./wire.js";

describe("resolveAcpDialect", () => {
  // The registration names the dialect, so the same agent behind a wrapper
  // script — or registered by a third-party plugin under another id — still
  // gets its side channels read.
  it("takes the dialect the registration named", () => {
    expect(
      resolveAcpDialect({ dialectId: "grok", command: "/opt/wrappers/agent" }),
    ).toBe(GROK_ACP_DIALECT);
    expect(
      resolveAcpDialect({ dialectId: "cursor", command: "node" }),
    ).toBe(CURSOR_ACP_DIALECT);
  });

  it("falls back to the launch executable's base name", () => {
    expect(resolveAcpDialect({ command: "grok" })).toBe(GROK_ACP_DIALECT);
    expect(resolveAcpDialect({ command: "/usr/local/bin/grok" })).toBe(
      GROK_ACP_DIALECT,
    );
    expect(resolveAcpDialect({ command: "cursor-agent" })).toBe(
      CURSOR_ACP_DIALECT,
    );
  });

  it("is generic for a dialect id it does not ship", () => {
    expect(
      resolveAcpDialect({ dialectId: "amp", command: "cursor-agent" }),
    ).toBe(GENERIC_ACP_DIALECT);
  });

  // Selecting on the launch command, not a bb provider id, is what lets a
  // user-configured instance of the same agent get the same dialect.
  it("gives an unknown agent the generic dialect, which answers nothing", () => {
    const dialect = resolveAcpDialect({ command: "opencode" });
    expect(dialect).toBe(GENERIC_ACP_DIALECT);
    expect(dialect.toolIdentity).toBeUndefined();
    expect(dialect.classifyToolCall).toBeUndefined();
    expect(dialect.handleClientRequest).toBeUndefined();
  });
});

const toolCall = (fields: Partial<AcpToolCallUpdateEvent>) =>
  ({
    sessionUpdate: "tool_call",
    toolCallId: "call-1",
    ...fields,
  }) as AcpToolCallUpdateEvent;

describe("grok sub-agents", () => {
  // Version 1 of the protocol has no sub-agent concept, so only the dialect
  // can know that this tool call is delegated work.
  it("maps a spawn_subagent call to a delegation", () => {
    expect(
      GROK_ACP_DIALECT.classifyToolCall?.(
        toolCall({
          title: "spawn_subagent",
          rawInput: {
            description: "Audit the config loader",
            subagent_type: "explore",
          },
          _meta: { "x.ai/tool": { name: "spawn_subagent", kind: "other" } },
        }),
      ),
    ).toEqual({
      item: {
        type: "delegation",
        childRef: "call-1",
        label: "Audit the config loader",
        background: false,
      },
      presentation: {
        label: { pending: "Running subagent", completed: "Subagent finished" },
        icon: { glyph: "UserRound" },
        title: "Audit the config loader",
        detail: "explore",
      },
    });
  });

  it("leaves every other grok tool to the shared classifier", () => {
    expect(
      GROK_ACP_DIALECT.classifyToolCall?.(
        toolCall({
          title: "run_terminal_command",
          _meta: { "x.ai/tool": { name: "run_terminal_command" } },
        }),
      ),
    ).toBeUndefined();
  });
});

describe("cursor sub-agents", () => {
  it("maps a task tool call to a delegation from its rawInput tool name", () => {
    expect(
      CURSOR_ACP_DIALECT.classifyToolCall?.(
        toolCall({
          title: "Task: Subagent task",
          kind: "other",
          rawInput: { _toolName: "task" },
        }),
      ),
    ).toMatchObject({
      item: { type: "delegation", childRef: "call-1", background: false },
      presentation: { icon: { glyph: "UserRound" } },
    });
  });

  // bb answered cursor/task with -32601: a protocol error for a request the
  // agent is entitled to send, and the sub-agent detail was thrown away.
  it("acknowledges cursor/task and reports the sub-agent it names", () => {
    expect(
      CURSOR_ACP_DIALECT.handleClientRequest?.("cursor/task", {
        toolCallId: "call-1",
        description: "Read README first line",
        prompt: "Read the file README.md…",
        subagentType: { custom: { unspecified: {} } },
        model: "default",
        agentId: "78d1cd3b-94d2-4c87-82a2-c83fe54712f1",
        durationMs: 4764,
      }),
    ).toEqual({
      result: {},
      delegation: {
        toolCallId: "call-1",
        childRef: "78d1cd3b-94d2-4c87-82a2-c83fe54712f1",
        label: "Read README first line",
        detail: "model default",
      },
    });
  });

  it("still acknowledges a cursor/task it cannot read, and claims nothing else", () => {
    expect(
      CURSOR_ACP_DIALECT.handleClientRequest?.("cursor/task", { nope: true }),
    ).toEqual({ result: {} });
    expect(
      CURSOR_ACP_DIALECT.handleClientRequest?.("cursor/other", {}),
    ).toBeUndefined();
  });
});

describe("grok dialect", () => {
  const identity = (meta: unknown) =>
    GROK_ACP_DIALECT.toolIdentity?.({
      sessionUpdate: "tool_call",
      toolCallId: "call-1",
      _meta: meta,
    } as Parameters<NonNullable<typeof GROK_ACP_DIALECT.toolIdentity>>[0]);

  it("reads the tool name and kind from x.ai/tool", () => {
    expect(
      identity({
        "x.ai/tool": {
          version: 1,
          name: "run_terminal_command",
          kind: "execute",
          namespace: "grok_build",
        },
      }),
    ).toEqual({ name: "run_terminal_command", kind: "execute" });
  });

  // The side channel is the vendor's, so it is read defensively: a kind bb's
  // vocabulary does not have is no kind at all, and a call with no _meta
  // leaves every decision to the protocol fields.
  it("ignores a kind outside the ACP vocabulary and a missing _meta", () => {
    expect(
      identity({ "x.ai/tool": { name: "deploy_thing", kind: "deploy" } }),
    ).toEqual({ name: "deploy_thing" });
    expect(identity(undefined)).toBeUndefined();
    expect(identity({ "other.vendor/tool": { name: "x" } })).toBeUndefined();
  });
});
