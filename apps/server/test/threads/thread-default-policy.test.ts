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
  "parentThreadId" | "projectId" | "providerId" | "type"
>;
type PolicyTestParentThread = Pick<
  Thread,
  "archivedAt" | "deletedAt" | "environmentId" | "id" | "projectId" | "type"
>;

function makeThread(
  overrides: Partial<PolicyTestThread> = {},
): PolicyTestThread {
  return {
    parentThreadId: null,
    projectId: "proj-1",
    providerId: "codex",
    type: "standard",
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

function makeManagerParentThread(
  overrides: Partial<PolicyTestParentThread> = {},
): PolicyTestParentThread {
  return {
    archivedAt: null,
    deletedAt: null,
    environmentId: "env-manager-1",
    id: "thr-manager-1",
    projectId: "proj-1",
    type: "manager",
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
  it("uses the server-owned Codex manager defaults when a manager omits provider and stored defaults", () => {
    expect(
      resolveCreateThreadExecutionDefaults({
        storedDefaults: null,
        threadType: "manager",
      }),
    ).toEqual({
      providerId: "codex",
      executionDefaults: {
        providerId: "codex",
        model: "gpt-5.5",
        reasoningLevel: "xhigh",
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
        threadType: "manager",
      }),
    ).toEqual({
      providerId: "pi",
      executionDefaults: null,
    });
  });

  it("reuses matching stored defaults for standard threads", () => {
    const storedDefaults = makeDefaults({
      model: "gpt-5.1",
      permissionMode: "readonly",
    });

    expect(
      resolveCreateThreadExecutionDefaults({
        storedDefaults,
        threadType: "standard",
      }),
    ).toEqual({
      providerId: "codex",
      executionDefaults: storedDefaults,
    });
  });
});

describe("resolveCreateThreadEnvironment", () => {
  it("defaults implicit manager-child host environments to managed worktrees", () => {
    expect(
      resolveCreateThreadEnvironment({
        parentThread: makeManagerParentThread(),
        projectId: "proj-1",
        requestedEnvironment: {
          type: "host",
          hostId: "host-1",
          workspace: { type: "unmanaged", path: null },
        },
        threadType: "standard",
      }),
    ).toEqual({
      type: "host",
      hostId: "host-1",
      workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
    });
  });

  it("keeps explicit same-environment reuse for manager children", () => {
    expect(
      resolveCreateThreadEnvironment({
        parentThread: makeManagerParentThread(),
        projectId: "proj-1",
        requestedEnvironment: {
          type: "reuse",
          environmentId: "env-1",
        },
        threadType: "standard",
      }),
    ).toEqual({
      type: "reuse",
      environmentId: "env-1",
    });
  });

  it("defaults personal manager children to the manager environment", () => {
    expect(
      resolveCreateThreadEnvironment({
        parentThread: makeManagerParentThread({
          environmentId: "env-personal-manager",
          projectId: PERSONAL_PROJECT_ID,
        }),
        projectId: PERSONAL_PROJECT_ID,
        requestedEnvironment: {
          type: "host",
          workspace: { type: "personal" },
        },
        threadType: "standard",
      }),
    ).toEqual({
      type: "reuse",
      environmentId: "env-personal-manager",
    });
  });

  it.each([
    {
      args: {
        parentThread: makeManagerParentThread(),
        projectId: "proj-1",
        requestedEnvironment: {
          type: "host" as const,
          hostId: "host-1",
          workspace: { type: "unmanaged" as const, path: null },
        },
        threadType: "manager" as const,
      },
      name: "non-standard thread types",
    },
    {
      args: {
        parentThread: null,
        projectId: "proj-1",
        requestedEnvironment: {
          type: "host" as const,
          hostId: "host-1",
          workspace: { type: "unmanaged" as const, path: null },
        },
        threadType: "standard" as const,
      },
      name: "requests without a parent thread",
    },
    {
      args: {
        parentThread: makeManagerParentThread({
          type: "standard",
        }),
        projectId: "proj-1",
        requestedEnvironment: {
          type: "host" as const,
          hostId: "host-1",
          workspace: { type: "unmanaged" as const, path: null },
        },
        threadType: "standard" as const,
      },
      name: "non-manager parents",
    },
    {
      args: {
        parentThread: makeManagerParentThread({
          projectId: "proj-2",
        }),
        projectId: "proj-1",
        requestedEnvironment: {
          type: "host" as const,
          hostId: "host-1",
          workspace: { type: "unmanaged" as const, path: null },
        },
        threadType: "standard" as const,
      },
      name: "parents from another project",
    },
    {
      args: {
        parentThread: makeManagerParentThread(),
        projectId: "proj-1",
        requestedEnvironment: {
          type: "host" as const,
          hostId: "host-1",
          workspace: { type: "unmanaged" as const, path: "/tmp/existing" },
        },
        threadType: "standard" as const,
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
  it("keeps the preferred managed-child default for non-agent providers", () => {
    expect(
      resolveThreadDefaultPermissionMode({
        parentThread: makeManagerParentThread(),
        thread: makeThread({
          parentThreadId: "thr-manager-1",
          providerId: "custom-provider",
        }),
      }),
    ).toBe("workspace-write");
  });

  it("falls back to full for Pi managed-child threads because Pi does not support workspace-write", () => {
    expect(
      resolveThreadDefaultPermissionMode({
        parentThread: makeManagerParentThread(),
        thread: makeThread({
          parentThreadId: "thr-manager-1",
          providerId: "pi",
        }),
      }),
    ).toBe("full");
  });

  it("treats invalid parent references as root-thread defaults", () => {
    expect(
      resolveThreadDefaultPermissionMode({
        parentThread: makeManagerParentThread({
          type: "standard",
        }),
        thread: makeThread({
          parentThreadId: "thr-non-manager-1",
          providerId: "codex",
        }),
      }),
    ).toBe("full");
  });
});

describe("resolveThreadExecutionPermissionMode", () => {
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

  it("ignores project permission defaults for managed child threads", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        parentThread: makeManagerParentThread(),
        projectExecutionPermissionMode: "full",
        thread: makeThread({
          parentThreadId: "thr-manager-1",
          providerId: "codex",
        }),
      }),
    ).toBe("workspace-write");
  });

  it("uses root-thread defaults when the parent reference is not a live manager", () => {
    expect(
      resolveThreadExecutionPermissionMode({
        parentThread: makeManagerParentThread({
          deletedAt: Date.now(),
        }),
        projectExecutionPermissionMode: "readonly",
        thread: makeThread({
          parentThreadId: "thr-deleted-manager-1",
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
