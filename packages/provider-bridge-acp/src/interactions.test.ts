import { describe, expect, it } from "vitest";
import { CURSOR_ACP_DIALECT } from "./dialect.js";
import {
  buildAcpApprovalDecisions,
  buildAcpPermissionInteractionPayload,
} from "./interactions.js";

const allowDenyOptions = [
  { kind: "allow_once" },
  { kind: "reject_once" },
] as const;

// Historical fix 79f591bea: an ACP `session/request_permission` may carry an
// arbitrarily sparse toolCall, but the canonical payload must always end up
// with a grantable approval subject — never an empty payload the user cannot
// act on. A command asks as `command`; everything that is neither a command
// nor a file change asks as `tool_use` with the timeline row's presentation.
describe("buildAcpPermissionInteractionPayload", () => {
  it("uses the tool call command when present", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "call-1",
        title: "Run command",
        kind: "execute",
        rawInput: { command: "git status" },
      },
      options: allowDenyOptions,
    });

    expect(payload).toMatchObject({
      kind: "approval",
      subject: {
        kind: "command",
        itemId: "call-1",
        command: "git status",
        actions: [{ type: "unknown", command: "git status" }],
      },
    });
  });

  it("asks as tool_use with the kind's presentation and the title as the headline", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: { toolCallId: "call-2", title: "Fetch docs", kind: "fetch" },
      options: allowDenyOptions,
    });

    expect(payload).toMatchObject({
      subject: {
        kind: "tool_use",
        itemId: "call-2",
        tool: "fetch",
        presentation: {
          label: { pending: "Fetching", completed: "Fetched" },
          icon: { glyph: "Globe" },
          title: "Fetch docs",
        },
      },
    });
  });

  it("keeps a Cursor sub-agent's delegation reading when it asks, like its row", () => {
    // Cursor announces a sub-agent as `kind: "other"` with `rawInput._toolName
    // = "task"`; only the dialect can read that. Without it the ask would be
    // a generic `other` tool while the timeline row reads as a delegation.
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "call-sub",
        title: "Task: Subagent task",
        kind: "other",
        rawInput: { _toolName: "task", description: "Find the bug" },
      },
      options: allowDenyOptions,
      classifyToolCall: CURSOR_ACP_DIALECT.classifyToolCall,
    });

    expect(payload).toMatchObject({
      subject: {
        kind: "tool_use",
        itemId: "call-sub",
        presentation: {
          label: { pending: "Running subagent", completed: "Subagent finished" },
          title: "Task: Subagent task",
        },
      },
    });
    // The dialect is consulted for the in-flight call too, when the ask
    // itself has no title.
    const fromStarted = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "call-sub-2",
        kind: "other",
        startedToolCall: {
          sessionUpdate: "tool_call",
          toolCallId: "call-sub-2",
          title: "Task: Subagent task",
          kind: "other",
          rawInput: { _toolName: "task" },
        },
      },
      options: allowDenyOptions,
      classifyToolCall: CURSOR_ACP_DIALECT.classifyToolCall,
    });
    expect(fromStarted).toMatchObject({
      subject: {
        kind: "tool_use",
        presentation: { label: { pending: "Running subagent" } },
      },
    });
  });

  it("names the core kind when the call maps to one", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "call-3",
        title: "Read File",
        kind: "read",
        locations: [{ path: "/etc/hosts" }],
      },
      options: allowDenyOptions,
    });

    expect(payload).toMatchObject({
      subject: {
        kind: "tool_use",
        tool: "read",
        presentation: {
          label: { pending: "Reading file", completed: "Read file" },
          title: "hosts",
        },
      },
    });
  });

  it("asks as the bound bb tool with its definition's presentation", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "call-mcp",
        title: "MCP: tool",
        kind: "other",
        injectedTool: {
          name: "ask_user_question",
          presentation: {
            label: { pending: "Asking a question", completed: "Asked" },
            icon: { glyph: "MessageQuestion" },
          },
        },
      },
      options: allowDenyOptions,
    });

    expect(payload).toMatchObject({
      subject: {
        kind: "tool_use",
        tool: "ask_user_question",
        presentation: { label: { pending: "Asking a question" } },
      },
    });
  });

  it("still yields a grantable subject for a tool call with no descriptive fields", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: { toolCallId: "call-4" },
      options: allowDenyOptions,
    });

    if (payload.kind !== "approval") {
      throw new Error("Expected an approval payload");
    }
    expect(payload.subject).toEqual({
      kind: "tool_use",
      itemId: "call-4",
      tool: "tool",
      presentation: {
        label: { pending: "Running tool", completed: "Ran tool" },
        icon: { glyph: "Toolbox" },
      },
    });
    expect(payload.availableDecisions.length).toBeGreaterThan(0);
  });

  it("takes the headline from the in-flight call when the permission itself has no title", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "call-5",
        kind: "other",
        startedToolCall: {
          sessionUpdate: "tool_call",
          toolCallId: "call-5",
          title: "Search the web",
          kind: "other",
        },
      },
      options: allowDenyOptions,
    });

    expect(payload).toMatchObject({
      subject: {
        kind: "tool_use",
        tool: "other",
        presentation: { title: "Search the web" },
      },
    });
  });

  it("still yields a grantable subject when the request carries no tool call at all", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: undefined,
      options: allowDenyOptions,
    });

    if (payload.kind !== "approval") {
      throw new Error("Expected an approval payload");
    }
    expect(payload.subject).toEqual({
      kind: "tool_use",
      itemId: "acp-permission",
      tool: "tool",
      presentation: {
        label: { pending: "Running tool", completed: "Ran tool" },
        icon: { glyph: "Toolbox" },
        title: "ACP permission request",
      },
    });
    expect(payload.availableDecisions).toEqual(["allow_once", "deny"]);
  });
});

describe("buildAcpApprovalDecisions", () => {
  it("maps the full ACP option vocabulary onto canonical decisions", () => {
    expect(
      buildAcpApprovalDecisions([
        { kind: "allow_once" },
        { kind: "allow_always" },
        { kind: "reject_once" },
        { kind: "reject_always" },
      ]),
    ).toEqual(["allow_once", "allow_for_session", "deny"]);
  });

  it("never returns an empty decision list", () => {
    // A payload without decisions is unresolvable: the runtime's auto-deny
    // policy could not settle it. Even an empty/unrecognized option list must
    // yield at least deny.
    expect(buildAcpApprovalDecisions([])).toEqual(["deny"]);
  });
});

// Fix for get-bb/bb#1719: an ACP `session/request_permission` for a file
// write must surface as a file-change approval subject, not as a command
// approval whose "command" is a bare path. Two shapes opencode sends:
//   1. `write`/`edit` permission: kind "edit", title = file path,
//      locations = [file], no `command`.
//   2. `external_directory` permission (write outside the project): kind
//      "other", title = parentDir (a bare directory), locations = [file,
//      parentDir], no `command`. The running `edit` tool call with the same
//      id is the write signal.
describe("buildAcpPermissionInteractionPayload file-change subjects", () => {
  it("classifies an edit-kind permission that names a path as a file_change subject", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "write-tool-1",
        title: "/tmp/qa-1719/notes.md",
        kind: "edit",
        locations: [{ path: "/tmp/qa-1719/notes.md" }],
      },
      options: allowDenyOptions,
    });

    expect(payload).toMatchObject({
      kind: "approval",
      subject: {
        kind: "file_change",
        itemId: "write-tool-1",
        writeScope: "/tmp/qa-1719/notes.md",
        sessionGrant: null,
      },
    });
  });

  it("classifies an opencode external_directory permission as a file_change subject when the in-flight tool call is an edit", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "write-tool-1",
        title: "/tmp/qa-1719",
        kind: "other",
        locations: [
          { path: "/tmp/qa-1719/notes.md" },
          { path: "/tmp/qa-1719" },
        ],
        rawInput: {
          filepath: "/tmp/qa-1719/notes.md",
          parentDir: "/tmp/qa-1719",
        },
        startedToolCall: {
          sessionUpdate: "tool_call",
          toolCallId: "write-tool-1",
          title: "Editing notes.md",
          kind: "edit",
          locations: [{ path: "/tmp/qa-1719/notes.md" }],
        },
      },
      options: allowDenyOptions,
    });

    expect(payload).toMatchObject({
      subject: {
        kind: "file_change",
        itemId: "write-tool-1",
        writeScope: "/tmp/qa-1719",
      },
    });
  });

  it("keeps a generic other-kind permission with locations a tool_use subject when nothing signals a write", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "read-tool-1",
        title: "Read secrets.txt",
        kind: "other",
        locations: [{ path: "/tmp/qa-1719/secrets.txt" }],
        startedToolCall: {
          sessionUpdate: "tool_call",
          toolCallId: "read-tool-1",
          title: "Reading secrets.txt",
          kind: "read",
          locations: [{ path: "/tmp/qa-1719/secrets.txt" }],
        },
      },
      options: allowDenyOptions,
    });

    expect(payload).toMatchObject({
      subject: {
        kind: "tool_use",
        tool: "other",
        presentation: { title: "Read secrets.txt" },
      },
    });
  });

  it("keeps a path-pending edit permission aligned with its file-change row", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "write-tool-2",
        title: "Edit file",
        kind: "edit",
      },
      options: allowDenyOptions,
    });

    expect(payload).toMatchObject({
      subject: {
        kind: "file_change",
        itemId: "write-tool-2",
        writeScope: null,
      },
    });
  });

  it("keeps a move-kind permission a tool_use subject, like the timeline", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "move-tool-1",
        title: "Move notes.md",
        kind: "move",
        locations: [{ path: "/tmp/a/notes.md" }, { path: "/tmp/b/notes.md" }],
      },
      options: allowDenyOptions,
    });

    expect(payload).toMatchObject({
      subject: {
        kind: "tool_use",
        tool: "move",
        presentation: {
          label: { pending: "Moving file", completed: "Moved file" },
          title: "Move notes.md",
        },
      },
    });
  });

  it("uses a null write scope when a blank location path is the only one", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "write-tool-3",
        kind: "edit",
        locations: [{ path: "" }],
        rawInput: { path: "/tmp/qa-1719/notes.md" },
      },
      options: allowDenyOptions,
    });

    expect(payload).toMatchObject({
      subject: { kind: "file_change", writeScope: "/tmp/qa-1719/notes.md" },
    });
  });
});

// M5: a permission's `content` is the agent's reason for asking ("Not in
// allowlist: node"), not the call's output. It rides the payload's reason and
// the banner's detail line so the user learns why they are being asked.
describe("permission reason", () => {
  it("carries the agent's reason on a command approval", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "call-1",
        title: "`node -e 1`",
        kind: "execute",
        rawInput: { command: "node -e 1" },
        content: [
          {
            type: "content",
            content: { type: "text", text: "Not in allowlist: node" },
          },
        ],
      },
      options: allowDenyOptions,
    });

    expect(payload).toMatchObject({
      kind: "approval",
      reason: "Not in allowlist: node",
      subject: { kind: "command", command: "node -e 1" },
    });
  });

  // Every surface reads `payload.reason` as the ask's title and
  // `presentation.detail` as a line beneath it, so a reason in both printed
  // the agent's sentence twice.
  it("carries the reason once, not again as the banner's detail", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "call-2",
        title: "MCP: deploy",
        kind: "other",
        content: [
          {
            type: "content",
            content: { type: "text", text: "This tool is not allowlisted." },
          },
        ],
      },
      options: allowDenyOptions,
    });

    expect(payload).toMatchObject({
      kind: "approval",
      reason: "This tool is not allowlisted.",
      subject: { kind: "tool_use" },
    });
    const subject = payload.kind === "approval" ? payload.subject : undefined;
    expect(
      subject?.kind === "tool_use" ? subject.presentation.detail : "unset",
    ).toBeUndefined();
  });

  // Nothing is lost by not stamping it: every surface reads the reason from
  // the payload, where it is the ask's title.
  it("still names the tool when the agent gives no reason", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: { toolCallId: "call-2b", title: "MCP: deploy", kind: "other" },
      options: allowDenyOptions,
    });

    const subject = payload.kind === "approval" ? payload.subject : undefined;
    expect(payload).toMatchObject({ kind: "approval", reason: null });
    expect(subject?.kind).toBe("tool_use");
    expect(
      subject?.kind === "tool_use" ? subject.presentation.detail : "unset",
    ).toBeUndefined();
    expect(
      subject?.kind === "tool_use" ? subject.presentation.title : undefined,
    ).toBeDefined();
  });

  it("resolves a relative permission path against the session cwd", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "call-3",
        title: "Edit notes.md",
        kind: "edit",
        locations: [{ path: "notes/todo.md" }],
      },
      options: allowDenyOptions,
      cwd: "/workspace/app",
    });

    expect(payload).toMatchObject({
      kind: "approval",
      subject: {
        kind: "file_change",
        writeScope: "/workspace/app/notes/todo.md",
      },
    });
  });
});
