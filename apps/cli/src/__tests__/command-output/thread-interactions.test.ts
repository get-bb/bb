import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  collectLogPayloads,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread interactions command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("bb thread interactions list renders the shared borderless table", async () => {
    const listInteractions = vi.fn(async () => [
      fixtures.makePendingInteraction({
        id: "int-1",
        providerId: "codex",
        threadId: "thread-1",
      }),
    ]);
    stubServerApi({ "v1.threads.:id.interactions.$get": listInteractions });

    await runCommand(["thread", "interactions", "list", "thread-1"], register);

    expect(listInteractions).toHaveBeenCalledWith({
      param: { id: "thread-1" },
    });
    const lines = collectLogPayloads(vi.mocked(console.log));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("");
    expect(lines[1]).toContain("ID");
    expect(lines[1]).toContain("Kind");
    expect(lines[1]).toContain("Status");
    expect(lines[1]).toContain("Summary");
    expect(lines[1]).toContain("int-1");
    expect(lines[1]).toContain("command");
    expect(lines[1]).toContain("pending");
    expect(lines[1]).toContain("Approve command");
    expect(lines[2]).toBe("");
  });

  it("bb thread interactions show prints interaction details", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-show-interaction");
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-show",
        providerId: "codex",
        threadId: "thread-show-interaction",
      }),
    );
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
    });

    await runCommand(
      ["thread", "interactions", "show", "int-show", "--self"],
      register,
    );

    expect(getInteraction).toHaveBeenCalledWith({
      param: {
        id: "thread-show-interaction",
        interactionId: "int-show",
      },
    });
    expect(collectLogLines(vi.mocked(console.error))).toEqual([]);
    const lines = collectLogLines(vi.mocked(console.log));
    expect(lines.slice(0, 4)).toEqual([
      "Interaction: int-show",
      "  Thread: thread-show-interaction",
      "  Kind: command",
      "  Status: pending",
    ]);
    expect(lines[4]).toMatch(/^  Created: /);
    expect(lines.slice(5)).toEqual([
      "  Command: git push",
      "  Cwd: /tmp/project",
      "  Prompt: Approve command",
      "  Decisions: allow_once, allow_for_session, deny",
    ]);
  });

  it("bb thread interactions show prints user question details", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-show-question");
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-question",
        providerId: "claude-code",
        threadId: "thread-show-question",
        status: "resolved",
        resolvedAt: Date.now(),
        payload: fixtures.makeUserQuestionPayload(),
        resolution: {
          kind: "user_answer",
          answers: {
            "question-1": {
              selected: ["staging"],
              freeText: "Use staging url=https://staging.example.com first.",
            },
          },
        },
      }),
    );
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
    });

    await runCommand(
      ["thread", "interactions", "show", "int-question", "--self"],
      register,
    );

    const lines = collectLogLines(vi.mocked(console.log));
    expect(lines).toContain("  Kind: question");
    expect(lines).toContain("  Questions:");
    expect(lines).toContain("    - Path: Which deployment path?");
    expect(lines).toContain("      Options: Staging, Production");
    expect(lines).toContain("      Free text: allowed");
    expect(lines).toContain("Answers:");
    expect(lines).toContain(
      "  Path: Staging, Use staging url=https://staging.example.com first.",
    );
  });

  it("bb thread interactions answer resolves single-question interactions with shorthand flags", async () => {
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-question-answer",
        providerId: "claude-code",
        threadId: "thread-question-answer",
        payload: fixtures.makeUserQuestionPayload(),
      }),
    );
    const resolveInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-question-answer",
        providerId: "claude-code",
        threadId: "thread-question-answer",
        payload: fixtures.makeUserQuestionPayload(),
        status: "resolving",
        resolvedAt: null,
        resolution: {
          kind: "user_answer",
          answers: {
            "question-1": {
              selected: ["staging"],
              freeText: "Use staging first.",
            },
          },
        },
      }),
    );
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
      "v1.threads.:id.interactions.:interactionId.resolve.$post":
        resolveInteraction,
    });

    await runCommand(
      [
        "thread",
        "interactions",
        "answer",
        "int-question-answer",
        "thread-question-answer",
        "--choice",
        "staging",
        "--text",
        "Use staging url=https://staging.example.com first.",
      ],
      register,
    );

    expect(resolveInteraction).toHaveBeenCalledWith({
      param: {
        id: "thread-question-answer",
        interactionId: "int-question-answer",
      },
      json: {
        kind: "user_answer",
        answers: {
          "question-1": {
            selected: ["staging"],
            freeText: "Use staging url=https://staging.example.com first.",
          },
        },
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Interaction int-question-answer submitted (answered); delivering to provider",
    ]);
  });

  it("bb thread interactions answer resolves multi-question interactions with explicit question ids", async () => {
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-question-multi",
        providerId: "claude-code",
        threadId: "thread-question-multi",
        payload: fixtures.makeMultiUserQuestionPayload(),
      }),
    );
    const resolveInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-question-multi",
        providerId: "claude-code",
        threadId: "thread-question-multi",
        payload: fixtures.makeMultiUserQuestionPayload(),
        status: "resolving",
        resolvedAt: null,
        resolution: {
          kind: "user_answer",
          answers: {
            "question-1": {
              selected: ["production"],
            },
            "question-2": {
              selected: [],
              freeText: "Wait for url=https://qa.example.com.",
            },
          },
        },
      }),
    );
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
      "v1.threads.:id.interactions.:interactionId.resolve.$post":
        resolveInteraction,
    });

    await runCommand(
      [
        "thread",
        "interactions",
        "answer",
        "int-question-multi",
        "thread-question-multi",
        "--choice",
        "question-1=production",
        "--text",
        "question-2=Wait for url=https://qa.example.com.",
      ],
      register,
    );

    expect(resolveInteraction).toHaveBeenCalledWith({
      param: {
        id: "thread-question-multi",
        interactionId: "int-question-multi",
      },
      json: {
        kind: "user_answer",
        answers: {
          "question-1": {
            selected: ["production"],
          },
          "question-2": {
            selected: [],
            freeText: "Wait for url=https://qa.example.com.",
          },
        },
      },
    });
  });

  it("bb thread interactions answer rejects shorthand for multi-question interactions", async () => {
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-question-shorthand",
        providerId: "claude-code",
        threadId: "thread-question-shorthand",
        payload: fixtures.makeMultiUserQuestionPayload(),
      }),
    );
    const resolveInteraction = vi.fn();
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
      "v1.threads.:id.interactions.:interactionId.resolve.$post":
        resolveInteraction,
    });

    await expect(
      runCommand(
        [
          "thread",
          "interactions",
          "answer",
          "int-question-shorthand",
          "thread-question-shorthand",
          "--choice",
          "staging",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(resolveInteraction).not.toHaveBeenCalled();
    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "shorthand can only be used for single-question interactions",
    );
  });

  it("bb thread interactions answer rejects unknown explicit text question ids", async () => {
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-question-unknown-text",
        providerId: "claude-code",
        threadId: "thread-question-unknown-text",
        payload: fixtures.makeMultiUserQuestionPayload(),
      }),
    );
    const resolveInteraction = vi.fn();
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
      "v1.threads.:id.interactions.:interactionId.resolve.$post":
        resolveInteraction,
    });

    await expect(
      runCommand(
        [
          "thread",
          "interactions",
          "answer",
          "int-question-unknown-text",
          "thread-question-unknown-text",
          "--text",
          "question-missing=Use staging",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(resolveInteraction).not.toHaveBeenCalled();
    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "Answer references unknown question 'question-missing'",
    );
  });

  it("bb thread interactions answer rejects approvals and invalid question choices before posting", async () => {
    const getInteraction = vi
      .fn()
      .mockResolvedValueOnce(
        fixtures.makePendingInteraction({
          id: "int-answer-approval",
          providerId: "codex",
          threadId: "thread-answer-approval",
        }),
      )
      .mockResolvedValueOnce(
        fixtures.makePendingInteraction({
          id: "int-answer-invalid-choice",
          providerId: "claude-code",
          threadId: "thread-answer-invalid-choice",
          payload: fixtures.makeUserQuestionPayload(),
        }),
      );
    const resolveInteraction = vi.fn();
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
      "v1.threads.:id.interactions.:interactionId.resolve.$post":
        resolveInteraction,
    });

    await expect(
      runCommand(
        [
          "thread",
          "interactions",
          "answer",
          "int-answer-approval",
          "thread-answer-approval",
          "--choice",
          "staging",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    await expect(
      runCommand(
        [
          "thread",
          "interactions",
          "answer",
          "int-answer-invalid-choice",
          "thread-answer-invalid-choice",
          "--choice",
          "qa",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(resolveInteraction).not.toHaveBeenCalled();
    const errorOutput = collectLogLines(vi.mocked(console.error)).join("\n");
    expect(errorOutput).toContain("cannot be answered with this command");
    expect(errorOutput).toContain("does not offer choice 'qa'");
  });

  it("bb thread interactions show indicates when resolution delivery is in progress", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-show-resolving");
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-show-resolving",
        providerId: "codex",
        threadId: "thread-show-resolving",
        status: "resolving",
        resolution: {
          decision: "allow_for_session",
          grantedPermissions: null,
        },
      }),
    );
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
    });

    await runCommand(
      ["thread", "interactions", "show", "int-show-resolving", "--self"],
      register,
    );

    const lines = collectLogLines(vi.mocked(console.log));
    expect(lines).toContain("  Status: resolving");
    expect(lines).toContain("  Delivery: waiting for provider acknowledgement");
    expect(lines).toContain("Resolution:");
    expect(lines).toContain("  Decision: allow_for_session");
  });

  it("bb thread interactions approve resolves command approvals for the current turn", async () => {
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-approve",
        providerId: "codex",
        threadId: "thread-approve",
      }),
    );
    const resolveInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-approve",
        providerId: "codex",
        threadId: "thread-approve",
        status: "resolving",
        resolvedAt: null,
        resolution: {
          decision: "allow_once",
          grantedPermissions: null,
        },
      }),
    );
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
      "v1.threads.:id.interactions.:interactionId.resolve.$post":
        resolveInteraction,
    });

    await runCommand(
      ["thread", "interactions", "approve", "int-approve", "thread-approve"],
      register,
    );

    expect(resolveInteraction).toHaveBeenCalledWith({
      param: {
        id: "thread-approve",
        interactionId: "int-approve",
      },
      json: {
        decision: "allow_once",
        grantedPermissions: null,
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Interaction int-approve submitted (approved); delivering to provider",
    ]);
  });

  it("bb thread interactions approve falls back to accept when session approval is unavailable", async () => {
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-approve-no-session",
        providerId: "codex",
        threadId: "thread-approve-no-session",
        payload: fixtures.makeCommandApprovalPayload(
          "item-approve-no-session",
          ["allow_once", "deny"],
        ),
      }),
    );
    const resolveInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-approve-no-session",
        providerId: "codex",
        threadId: "thread-approve-no-session",
        payload: fixtures.makeCommandApprovalPayload(
          "item-approve-no-session",
          ["allow_once", "deny"],
        ),
        status: "resolving",
        resolvedAt: null,
        resolution: {
          decision: "allow_once",
          grantedPermissions: null,
        },
      }),
    );
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
      "v1.threads.:id.interactions.:interactionId.resolve.$post":
        resolveInteraction,
    });

    await runCommand(
      [
        "thread",
        "interactions",
        "approve",
        "int-approve-no-session",
        "thread-approve-no-session",
      ],
      register,
    );

    expect(resolveInteraction).toHaveBeenCalledWith({
      param: {
        id: "thread-approve-no-session",
        interactionId: "int-approve-no-session",
      },
      json: {
        decision: "allow_once",
        grantedPermissions: null,
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Interaction int-approve-no-session submitted (approved); delivering to provider",
    ]);
  });

  it("bb thread interactions approve errors when no allow decision is available", async () => {
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-approve-amendment",
        providerId: "codex",
        threadId: "thread-approve-amendment",
        payload: fixtures.makeCommandApprovalPayload("item-approve-amendment", [
          "deny",
        ]),
      }),
    );
    const resolveInteraction = vi.fn();
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
      "v1.threads.:id.interactions.:interactionId.resolve.$post":
        resolveInteraction,
    });

    await expect(
      runCommand(
        [
          "thread",
          "interactions",
          "approve",
          "int-approve-amendment",
          "thread-approve-amendment",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(resolveInteraction).not.toHaveBeenCalled();
    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "does not offer an approval decision",
    );
  });

  it("bb thread interactions deny uses decline when it is available", async () => {
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-deny",
        providerId: "codex",
        threadId: "thread-deny",
      }),
    );
    const resolveInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-deny",
        providerId: "codex",
        threadId: "thread-deny",
        status: "resolving",
        resolvedAt: null,
        resolution: {
          decision: "deny",
        },
      }),
    );
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
      "v1.threads.:id.interactions.:interactionId.resolve.$post":
        resolveInteraction,
    });

    await runCommand(
      ["thread", "interactions", "deny", "int-deny", "thread-deny"],
      register,
    );

    expect(resolveInteraction).toHaveBeenCalledWith({
      param: {
        id: "thread-deny",
        interactionId: "int-deny",
      },
      json: {
        decision: "deny",
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Interaction int-deny submitted (denied); delivering to provider",
    ]);
  });

  it("bb thread interactions deny errors when deny is unavailable", async () => {
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-cancel",
        providerId: "codex",
        threadId: "thread-cancel",
        payload: fixtures.makeCommandApprovalPayload("item-cancel", [
          "allow_once",
        ]),
      }),
    );
    const resolveInteraction = vi.fn();
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
      "v1.threads.:id.interactions.:interactionId.resolve.$post":
        resolveInteraction,
    });

    await expect(
      runCommand(
        ["thread", "interactions", "deny", "int-cancel", "thread-cancel"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(resolveInteraction).not.toHaveBeenCalled();
    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "does not offer a deny decision",
    );
  });

  it("bb thread interactions approve resolves file-change approvals without granting extra permissions", async () => {
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-file-change",
        providerId: "codex",
        threadId: "thread-file-change",
        payload: fixtures.makeFileChangeApprovalPayload("item-file-change"),
      }),
    );
    const resolveInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-file-change",
        providerId: "codex",
        threadId: "thread-file-change",
        payload: fixtures.makeFileChangeApprovalPayload("item-file-change"),
        status: "resolving",
        resolvedAt: null,
        resolution: {
          decision: "allow_once",
          grantedPermissions: null,
        },
      }),
    );
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
      "v1.threads.:id.interactions.:interactionId.resolve.$post":
        resolveInteraction,
    });

    await runCommand(
      [
        "thread",
        "interactions",
        "approve",
        "int-file-change",
        "thread-file-change",
      ],
      register,
    );

    expect(resolveInteraction).toHaveBeenCalledWith({
      param: {
        id: "thread-file-change",
        interactionId: "int-file-change",
      },
      json: {
        decision: "allow_once",
        grantedPermissions: null,
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Interaction int-file-change submitted (approved); delivering to provider",
    ]);
  });

  it("bb thread interactions grant resolves permission requests", async () => {
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-permission-grant",
        providerId: "codex",
        threadId: "thread-permission-grant",
        payload: fixtures.makePermissionGrantApprovalPayload(
          "item-permission-grant",
        ),
      }),
    );
    const resolveInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-permission-grant",
        providerId: "codex",
        threadId: "thread-permission-grant",
        payload: fixtures.makePermissionGrantApprovalPayload(
          "item-permission-grant",
        ),
        status: "resolving",
        resolvedAt: null,
        resolution: {
          decision: "allow_for_session",
          grantedPermissions: {
            network: { enabled: true },
            fileSystem: {
              read: ["/tmp/project/README.md"],
              write: ["/tmp/project/notes.md"],
            },
          },
        },
      }),
    );
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
      "v1.threads.:id.interactions.:interactionId.resolve.$post":
        resolveInteraction,
    });

    await runCommand(
      [
        "thread",
        "interactions",
        "grant",
        "int-permission-grant",
        "thread-permission-grant",
      ],
      register,
    );

    expect(resolveInteraction).toHaveBeenCalledWith({
      param: {
        id: "thread-permission-grant",
        interactionId: "int-permission-grant",
      },
      json: {
        decision: "allow_for_session",
        grantedPermissions: {
          network: { enabled: true },
          fileSystem: {
            read: ["/tmp/project/README.md"],
            write: ["/tmp/project/notes.md"],
          },
        },
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Interaction int-permission-grant submitted (approved for this session); delivering to provider",
    ]);
  });

  it("bb thread interactions grant builds a semantic turn-scoped resolution from server interaction data", async () => {
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-claude-permission-grant",
        providerId: "claude-code",
        threadId: "thread-claude-permission-grant",
        payload: fixtures.makePermissionGrantApprovalPayload(
          "item-claude-permission-grant",
        ),
      }),
    );
    const resolveInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-claude-permission-grant",
        providerId: "claude-code",
        threadId: "thread-claude-permission-grant",
        payload: fixtures.makePermissionGrantApprovalPayload(
          "item-claude-permission-grant",
        ),
        status: "resolving",
        resolvedAt: null,
        resolution: {
          decision: "allow_once",
          grantedPermissions: {
            network: { enabled: true },
            fileSystem: {
              read: ["/tmp/project/README.md"],
              write: ["/tmp/project/notes.md"],
            },
          },
        },
      }),
    );
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
      "v1.threads.:id.interactions.:interactionId.resolve.$post":
        resolveInteraction,
    });

    await runCommand(
      [
        "thread",
        "interactions",
        "grant",
        "int-claude-permission-grant",
        "thread-claude-permission-grant",
        "--scope",
        "turn",
      ],
      register,
    );

    expect(resolveInteraction).toHaveBeenCalledWith({
      param: {
        id: "thread-claude-permission-grant",
        interactionId: "int-claude-permission-grant",
      },
      json: {
        decision: "allow_once",
        grantedPermissions: {
          network: { enabled: true },
          fileSystem: {
            read: ["/tmp/project/README.md"],
            write: ["/tmp/project/notes.md"],
          },
        },
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Interaction int-claude-permission-grant submitted (approved); delivering to provider",
    ]);
  });

  it("bb thread interactions deny resolves permission requests as denied", async () => {
    const getInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-permission-deny",
        providerId: "codex",
        threadId: "thread-permission-deny",
        payload: fixtures.makePermissionGrantApprovalPayload(
          "item-permission-deny",
        ),
      }),
    );
    const resolveInteraction = vi.fn(async () =>
      fixtures.makePendingInteraction({
        id: "int-permission-deny",
        providerId: "codex",
        threadId: "thread-permission-deny",
        payload: fixtures.makePermissionGrantApprovalPayload(
          "item-permission-deny",
        ),
        status: "resolving",
        resolvedAt: null,
        resolution: {
          decision: "deny",
        },
      }),
    );
    stubServerApi({
      "v1.threads.:id.interactions.:interactionId.$get": getInteraction,
      "v1.threads.:id.interactions.:interactionId.resolve.$post":
        resolveInteraction,
    });

    await runCommand(
      [
        "thread",
        "interactions",
        "deny",
        "int-permission-deny",
        "thread-permission-deny",
      ],
      register,
    );

    expect(resolveInteraction).toHaveBeenCalledWith({
      param: {
        id: "thread-permission-deny",
        interactionId: "int-permission-deny",
      },
      json: {
        decision: "deny",
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Interaction int-permission-deny submitted (denied); delivering to provider",
    ]);
  });
});
