import {
  PERSONAL_PROJECT_ID,
  type ProjectExecutionDefaults,
  type Thread,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  resolveCreateThreadEnvironment,
  resolveCreateThreadExecutionDefaults,
  resolveThreadDefaultPermissionMode,
  resolveThreadExecutionPermissionMode,
  resolveWorkflowsEnabledPolicy,
} from "../../src/services/threads/thread-default-policy.js";

type PolicyTestThread = Pick<
  Thread,
  "childOrigin" | "originKind" | "parentThreadId" | "projectId" | "providerId"
>;
type PolicyTestParentThread = Pick<
  Thread,
  | "archivedAt"
  | "deletedAt"
  | "environmentId"
  | "id"
  | "parentThreadId"
  | "projectId"
>;

function makeThread(
  overrides: Partial<PolicyTestThread> = {},
): PolicyTestThread {
  return {
    childOrigin: null,
    originKind: null,
    parentThreadId: null,
    projectId: "proj-1",
    providerId: "codex",
    ...overrides,
  };
}

function makeDefaults(
  overrides: Partial<ProjectExecutionDefaults> = {},
): ProjectExecutionDefaults {
  return {
    model: "gpt-5",
    permissionMode: "full",
    providerId: "codex",
    reasoningLevel: "medium",
    serviceTier: "default",
    ...overrides,
  };
}

function makeParentThread(
  overrides: Partial<PolicyTestParentThread> = {},
): PolicyTestParentThread {
  return {
    archivedAt: null,
    deletedAt: null,
    environmentId: "env-parent-1",
    id: "thr-parent-1",
    parentThreadId: null,
    projectId: "proj-1",
    ...overrides,
  };
}

describe("resolveWorkflowsEnabledPolicy", () => {
  it("enables workflows for claude-code sessions only", () => {
    expect(resolveWorkflowsEnabledPolicy("claude-code")).toBe(true);
    expect(resolveWorkflowsEnabledPolicy("codex")).toBe(false);
    expect(resolveWorkflowsEnabledPolicy("pi")).toBe(false);
  });
});

describe("resolveCreateThreadExecutionDefaults", () => {
  it("uses the server-owned Codex defaults when provider and stored defaults are omitted", () => {
    expect(
      resolveCreateThreadExecutionDefaults({
        storedDefaults: null,
      }),
    ).toEqual({
      providerId: "codex",
      executionDefaults: {
        providerId: "codex",
        model: "gpt-5.5",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
      },
    });
  });

  it("discards stored defaults when the resolved provider changes", () => {
    expect(
      resolveCreateThreadExecutionDefaults({
        requestedProviderId: "pi",
        storedDefaults: makeDefaults({
          providerId: "codex",
          model: "gpt-5.5",
        }),
      }),
    ).toEqual({
      providerId: "pi",
      executionDefaults: null,
    });
  });

  it("reuses matching stored defaults", () => {
    const storedDefaults = makeDefaults({
      model: "gpt-5.1",
      permissionMode: "readonly",
    });

    expect(
      resolveCreateThreadExecutionDefaults({
        storedDefaults,
      }),
    ).toEqual({
      providerId: "codex",
      executionDefaults: storedDefaults,
    });
  });
});

describe("resolveCreateThreadEnvironment", () => {
  it("defaults implicit child host environments to managed worktrees", () => {
    expect(
      resolveCreateThreadEnvironment({
        parentThread: makeParentThread(),
        projectId: "proj-1",
        requestedEnvironment: {
          type: "host",
          hostId: "host-1",
          workspace: { type: "unmanaged", path: null },
        },
      }),
    ).toEqual({
      type: "host",
      hostId: "host-1",
      workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
    });
  });

  it("keeps explicit same-environment reuse for child threads", () => {
    expect(
      resolveCreateThreadEnvironment({
        parentThread: makeParentThread(),
        projectId: "proj-1",
        requestedEnvironment: {
          type: "reuse",
          environmentId: "env-1",
        },
      }),
    ).toEqual({
      type: "reuse",
      environmentId: "env-1",
    });
  });

  it("defaults personal child threads to the parent environment", () => {
    expect(
      resolveCreateThreadEnvironment({
        parentThread: makeParentThread({
          environmentId: "env-personal-parent",
          projectId: PERSONAL_PROJECT_ID,
        }),
        projectId: PERSONAL_PROJECT_ID,
        requestedEnvironment: {
          type: "host",
          workspace: { type: "personal" },
        },
      }),
    ).toEqual({
      type: "reuse",
      environmentId: "env-personal-parent",
    });
  });

  it.each([
    {
      args: {
        parentThread: null,
        projectId: "proj-1",
        requestedEnvironment: {
          type: "host" as const,
          hostId: "host-1",
          workspace: { type: "unmanaged" as const, path: null },
        },
      },
      name: "requests without a parent thread",
    },
    {
      args: {
        parentThread: makeParentThread({
          deletedAt: 1,
        }),
        projectId: "proj-1",
        requestedEnvironment: {
          type: "host" as const,
          hostId: "host-1",
          workspace: { type: "unmanaged" as const, path: null },
        },
      },
      name: "deleted parents",
    },
    {
      args: {
        parentThread: makeParentThread({
          projectId: "proj-2",
        }),
        projectId: "proj-1",
        requestedEnvironment: {
          type: "host" as const,
          hostId: "host-1",
          workspace: { type: "unmanaged" as const, path: null },
        },
      },
      name: "parents from another project",
    },
    {
      args: {
        parentThread: makeParentThread(),
        projectId: "proj-1",
        requestedEnvironment: {
          type: "host" as const,
          hostId: "host-1",
          workspace: { type: "unmanaged" as const, path: "/tmp/existing" },
        },
      },
      name: "explicit unmanaged paths",
    },
  ])("passes through $name", ({ args }) => {
    expect(resolveCreateThreadEnvironment(args)).toEqual(
      args.requestedEnvironment,
    );
  });
});

describe("resolveThreadDefaultPermissionMode", () => {
  it("uses the full permission default for non-agent providers", () => {
    expect(
      resolveThreadDefaultPermissionMode({
        thread: makeThread({
          parentThreadId: "thr-parent-1",
          providerId: "custom-provider",
        }),
      }),
    ).toBe("full");
  });

  it("uses full for Pi threads", () => {
    expect(
      resolveThreadDefaultPermissionMode({
        thread: makeThread({
          parentThreadId: "thr-parent-1",
          providerId: "pi",
        }),
      }),
    ).toBe("full");
  });

  it("uses full for Codex threads", () => {
    expect(
      resolveThreadDefaultPermissionMode({
        thread: makeThread({
          parentThreadId: "thr-other-project-parent-1",
          providerId: "codex",
        }),
      }),
    ).toBe("full");
  });
});

describe("resolveThreadExecutionPermissionMode", () => {
  it("forces side chats to readonly before requested or stored permissions", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        requestedPermissionMode: "full",
        lastExecutionPermissionMode: "full",
        projectExecutionPermissionMode: "full",
        thread: makeThread({
          originKind: "side-chat",
        }),
      }),
    ).toBe("readonly");
  });

  it("prefers requested permission modes over every fallback", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        requestedPermissionMode: "readonly",
        lastExecutionPermissionMode: "workspace-write",
        projectExecutionPermissionMode: "full",
        thread: makeThread(),
      }),
    ).toBe("readonly");
  });

  it("uses the last execution permission mode before project or policy defaults", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        lastExecutionPermissionMode: "readonly",
        projectExecutionPermissionMode: "full",
        thread: makeThread(),
      }),
    ).toBe("readonly");
  });

  it("inherits live parent execution permission before project defaults", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        parentThread: makeParentThread(),
        parentThreadExecutionPermissionMode: "readonly",
        projectExecutionPermissionMode: "full",
        thread: makeThread({
          parentThreadId: "thr-parent-1",
          providerId: "codex",
        }),
      }),
    ).toBe("readonly");
  });

  it("uses project permission defaults for child threads without parent execution history", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        parentThread: makeParentThread(),
        projectExecutionPermissionMode: "full",
        thread: makeThread({
          parentThreadId: "thr-parent-1",
          providerId: "codex",
        }),
      }),
    ).toBe("full");
  });

  it("reconciles inherited parent permission to the child provider's supported modes", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        parentThread: makeParentThread(),
        parentThreadExecutionPermissionMode: "workspace-write",
        projectExecutionPermissionMode: "readonly",
        thread: makeThread({
          parentThreadId: "thr-parent-1",
          providerId: "pi",
        }),
      }),
    ).toBe("full");
  });

  it("uses root-thread defaults when the parent reference is not live", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        parentThread: makeParentThread({
          deletedAt: Date.now(),
        }),
        projectExecutionPermissionMode: "readonly",
        thread: makeThread({
          parentThreadId: "thr-deleted-parent-1",
          providerId: "codex",
        }),
      }),
    ).toBe("readonly");
  });

  it("still uses project permission defaults for root threads", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        projectExecutionPermissionMode: "readonly",
        thread: makeThread(),
      }),
    ).toBe("readonly");
  });
});
