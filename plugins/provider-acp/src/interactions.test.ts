import { describe, expect, it } from "vitest";
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
// with a grantable command-approval subject — never an empty payload the user
// cannot act on. The fallback chain is command → title → kind → fixed text.
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

  it("falls back to the title when there is no command", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: { toolCallId: "call-2", title: "Fetch docs", kind: "fetch" },
      options: allowDenyOptions,
    });

    expect(payload).toMatchObject({
      subject: { kind: "command", command: "Fetch docs" },
    });
  });

  it("falls back to the kind when there is no command or title", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: { toolCallId: "call-3", kind: "fetch" },
      options: allowDenyOptions,
    });

    expect(payload).toMatchObject({
      subject: { kind: "command", command: "fetch" },
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
    expect(payload.subject).toMatchObject({
      kind: "command",
      itemId: "call-4",
      command: "ACP permission request",
    });
    expect(payload.availableDecisions.length).toBeGreaterThan(0);
  });

  it("still yields a grantable subject when the request carries no tool call at all", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: undefined,
      options: allowDenyOptions,
    });

    if (payload.kind !== "approval") {
      throw new Error("Expected an approval payload");
    }
    expect(payload.subject).toMatchObject({
      kind: "command",
      itemId: "acp-permission",
      command: "ACP permission request",
      actions: [{ type: "unknown", command: "ACP permission request" }],
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

  it("keeps a generic other-kind permission with locations as a command subject when nothing signals a write", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "read-tool-1",
        title: "Read secrets.txt",
        kind: "other",
        locations: [{ path: "/tmp/qa-1719/secrets.txt" }],
        startedToolCall: {
          title: "Reading secrets.txt",
          kind: "read",
          locations: [{ path: "/tmp/qa-1719/secrets.txt" }],
        },
      },
      options: allowDenyOptions,
    });

    expect(payload).toMatchObject({
      subject: { kind: "command", command: "Read secrets.txt" },
    });
  });

  it("keeps an edit-kind permission without any path as a command subject, like the timeline", () => {
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
        kind: "command",
        itemId: "write-tool-2",
        command: "Edit file",
      },
    });
  });

  it("keeps a move-kind permission as a command subject, like the timeline", () => {
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
      subject: { kind: "command", command: "Move notes.md" },
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
