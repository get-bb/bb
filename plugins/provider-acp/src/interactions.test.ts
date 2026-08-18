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
        command: "git status",
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
//      parentDir], no `command`.
describe("buildAcpPermissionInteractionPayload file-change subjects", () => {
  it("classifies an edit-kind permission without a command as a file_change subject", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "write-tool-1",
        title: "/tmp/qa-1719/notes.md",
        kind: "edit",
        locations: ["/tmp/qa-1719/notes.md"],
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

  it("classifies an unclassified permission that names locations as a file_change subject with the containing directory as write scope", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "write-tool-1",
        title: "/tmp/qa-1719",
        kind: "other",
        locations: ["/tmp/qa-1719/notes.md", "/tmp/qa-1719"],
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

  it("keeps an edit-kind permission without locations as a file_change subject with a null write scope", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: { toolCallId: "write-tool-2", title: "notes.md", kind: "edit" },
      options: allowDenyOptions,
    });

    expect(payload).toMatchObject({
      subject: { kind: "file_change", itemId: "write-tool-2", writeScope: null },
    });
  });

  it("keeps a permission that carries a shell command as a command subject", () => {
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: {
        toolCallId: "call-5",
        title: "/tmp/qa-1719",
        kind: "other",
        command: "rm -rf /tmp/qa-1719",
        locations: ["/tmp/qa-1719"],
      },
      options: allowDenyOptions,
    });

    expect(payload).toMatchObject({
      subject: { kind: "command", command: "rm -rf /tmp/qa-1719" },
    });
  });
});
