import {
  PERSONAL_PROJECT_ID,
  type ProjectSource,
  type ThreadListEntry,
} from "@bb/domain";
import type {
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
  TerminalSession,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import type { ReuseThreadOption } from "@/components/pickers/WorktreePicker";
import {
  buildRootComposeTerminalSessions,
  buildMobileRecentThreads,
  canCreateRootComposeTerminal,
  hasSingleUseRootComposeTargetState,
  readFolderIdFromLocationState,
  readRootComposeFolderTargetFromLocationState,
  readInitialPromptFromLocationState,
  resolveRootComposeEffectiveEnvironmentValue,
  resolveRootComposePanelThreadId,
  shouldNavigateAfterThreadCreate,
} from "./RootComposeView";

interface MakeThreadArgs {
  id: string;
  projectId: string;
}

interface MakeProjectArgs {
  id: string;
  kind: ProjectWithThreadsResponse["kind"];
  name: string;
  threads: readonly ThreadListEntry[];
}

function makeProjectSource(hostId = "host_1"): ProjectSource {
  return {
    id: "src_1",
    projectId: "proj_app",
    type: "local_path",
    hostId,
    path: "/repo",
    isDefault: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeReuseThreadOption(environmentId: string): ReuseThreadOption {
  return {
    environmentId,
    branchName: "feature",
    name: null,
    threads: [{ id: "thr_1", title: "Thread" }],
  };
}

function makeThread(args: MakeThreadArgs): ThreadListEntry {
  return {
    id: args.id,
    projectId: args.projectId,
    environmentId: null,
    providerId: "codex",
    title: args.id,
    titleFallback: args.id,
    folderId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 100,
    latestAttentionAt: 100,
    createdAt: 100,
    updatedAt: 100,
    activity: { activeWorkflowCount: 0 },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
  };
}

function makeProject(args: MakeProjectArgs): ProjectWithThreadsResponse {
  return {
    id: args.id,
    kind: args.kind,
    name: args.name,
    sources: [],
    threads: [...args.threads],
    defaultExecutionOptions: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeTerminalSession(
  overrides: Partial<TerminalSession>,
): TerminalSession {
  return {
    id: "term_1",
    threadId: null,
    environmentId: null,
    hostId: "host_1",
    title: "Terminal",
    initialCwd: "/repo",
    cols: 100,
    rows: 30,
    status: "running",
    exitCode: null,
    closeReason: null,
    createdAt: 1,
    updatedAt: 1,
    lastUserInputAt: null,
    ...overrides,
  };
}

describe("buildMobileRecentThreads", () => {
  it("includes projectless and every project thread", () => {
    const sidebarNavigation: SidebarBootstrapResponse = {
      folders: [],
      personalProject: makeProject({
        id: PERSONAL_PROJECT_ID,
        kind: "personal",
        name: "Personal",
        threads: [
          makeThread({
            id: "thr_personal",
            projectId: PERSONAL_PROJECT_ID,
          }),
        ],
      }),
      projects: [
        makeProject({
          id: "proj_app",
          kind: "standard",
          name: "App",
          threads: [
            makeThread({
              id: "thr_app",
              projectId: "proj_app",
            }),
          ],
        }),
        makeProject({
          id: "proj_docs",
          kind: "standard",
          name: "Docs",
          threads: [
            makeThread({
              id: "thr_docs",
              projectId: "proj_docs",
            }),
          ],
        }),
      ],
    };

    const threadIds = buildMobileRecentThreads({ sidebarNavigation }).map(
      (thread) => thread.id,
    );

    expect(threadIds).toEqual(["thr_personal", "thr_app", "thr_docs"]);
  });
});

describe("readInitialPromptFromLocationState", () => {
  it("returns the initialPrompt string seeded by navigation state", () => {
    expect(
      readInitialPromptFromLocationState({
        focusPrompt: true,
        initialPrompt: "Create a new bb loop to ",
      }),
    ).toBe("Create a new bb loop to ");
  });

  it("returns null when no usable initialPrompt is present", () => {
    expect(readInitialPromptFromLocationState(null)).toBeNull();
    expect(readInitialPromptFromLocationState({})).toBeNull();
    expect(
      readInitialPromptFromLocationState({ initialPrompt: "" }),
    ).toBeNull();
    expect(
      readInitialPromptFromLocationState({ initialPrompt: 42 }),
    ).toBeNull();
  });
});

describe("readFolderIdFromLocationState", () => {
  it("returns a trimmed folder id seeded by navigation state", () => {
    expect(readFolderIdFromLocationState({ folderId: " fld_work " })).toBe(
      "fld_work",
    );
  });

  it("returns null when no usable folder id is present", () => {
    expect(readFolderIdFromLocationState(null)).toBeNull();
    expect(readFolderIdFromLocationState({})).toBeNull();
    expect(readFolderIdFromLocationState({ folderId: "" })).toBeNull();
    expect(readFolderIdFromLocationState({ folderId: 42 })).toBeNull();
  });
});

describe("readRootComposeFolderTargetFromLocationState", () => {
  it("returns a folder target when navigation provides a folder id", () => {
    expect(
      readRootComposeFolderTargetFromLocationState({ folderId: " fld_work " }),
    ).toEqual({ folderId: "fld_work", kind: "set" });
  });

  it("clears the folder target for plain new-thread focus navigation", () => {
    expect(
      readRootComposeFolderTargetFromLocationState({ focusPrompt: true }),
    ).toEqual({ kind: "clear" });
  });

  it("clears the folder target for an unusable folder id", () => {
    expect(readRootComposeFolderTargetFromLocationState({ folderId: "" }))
      .toEqual({ kind: "clear" });
  });

  it("returns null when no folder target instruction is present", () => {
    expect(readRootComposeFolderTargetFromLocationState(null)).toBeNull();
    expect(readRootComposeFolderTargetFromLocationState({})).toBeNull();
  });
});

describe("hasSingleUseRootComposeTargetState", () => {
  it("treats folder targets as single-use navigation state", () => {
    expect(hasSingleUseRootComposeTargetState({ folderId: "fld_work" })).toBe(
      true,
    );
  });

  it("treats plain new-thread navigation as single-use target state", () => {
    expect(hasSingleUseRootComposeTargetState({ focusPrompt: true })).toBe(
      true,
    );
  });

  it("ignores non-target state", () => {
    expect(hasSingleUseRootComposeTargetState(null)).toBe(false);
  });
});

describe("shouldNavigateAfterThreadCreate", () => {
  it("follows the preference for ordinary new threads", () => {
    expect(
      shouldNavigateAfterThreadCreate({
        isForkDraft: false,
        navigateToThreadAfterCreate: false,
      }),
    ).toBe(false);
    expect(
      shouldNavigateAfterThreadCreate({
        isForkDraft: false,
        navigateToThreadAfterCreate: true,
      }),
    ).toBe(true);
  });

  it("always navigates for submitted fork drafts", () => {
    expect(
      shouldNavigateAfterThreadCreate({
        isForkDraft: true,
        navigateToThreadAfterCreate: false,
      }),
    ).toBe(true);
  });
});

describe("resolveRootComposeEffectiveEnvironmentValue", () => {
  it("keeps host mode but rewrites the host id to the active project source host", () => {
    expect(
      resolveRootComposeEffectiveEnvironmentValue({
        environmentSelectionValue: "host:stale_host:worktree",
        isProjectless: false,
        primaryHostId: "host_1",
        projectSources: [makeProjectSource("host_1")],
        reuseThreadOptions: [],
        reuseThreadOptionsLoading: false,
      }),
    ).toBe("host:host_1:worktree");
  });

  it("does not invent a host workspace for a standard project without a source", () => {
    expect(
      resolveRootComposeEffectiveEnvironmentValue({
        environmentSelectionValue: "host:stale_host:local",
        isProjectless: false,
        primaryHostId: "host_1",
        projectSources: [],
        reuseThreadOptions: [],
        reuseThreadOptionsLoading: false,
      }),
    ).toBe("");
  });

  it("keeps a reuse environment only when it belongs to the selected project", () => {
    expect(
      resolveRootComposeEffectiveEnvironmentValue({
        environmentSelectionValue: "reuse:env_current",
        isProjectless: false,
        primaryHostId: "host_1",
        projectSources: [makeProjectSource("host_1")],
        reuseThreadOptions: [makeReuseThreadOption("env_current")],
        reuseThreadOptionsLoading: false,
      }),
    ).toBe("reuse:env_current");

    expect(
      resolveRootComposeEffectiveEnvironmentValue({
        environmentSelectionValue: "reuse:env_stale",
        isProjectless: false,
        primaryHostId: "host_1",
        projectSources: [makeProjectSource("host_1")],
        reuseThreadOptions: [makeReuseThreadOption("env_current")],
        reuseThreadOptionsLoading: false,
      }),
    ).toBe("host:host_1:local");
  });

  it("holds specific reuse values as incomplete while project worktrees load", () => {
    expect(
      resolveRootComposeEffectiveEnvironmentValue({
        environmentSelectionValue: "reuse:env_pending",
        isProjectless: false,
        primaryHostId: "host_1",
        projectSources: [makeProjectSource("host_1")],
        reuseThreadOptions: [],
        reuseThreadOptionsLoading: true,
      }),
    ).toBe("reuse");
  });

  it("uses the primary host for projectless threads without requiring project sources", () => {
    expect(
      resolveRootComposeEffectiveEnvironmentValue({
        environmentSelectionValue: "host:stale_host:worktree",
        isProjectless: true,
        primaryHostId: "host_1",
        projectSources: [],
        reuseThreadOptions: [],
        reuseThreadOptionsLoading: false,
      }),
    ).toBe("host:host_1:local");
  });
});

describe("buildRootComposeTerminalSessions", () => {
  it("keeps host-path terminal sessions unresolved until the global list loads", () => {
    expect(
      buildRootComposeTerminalSessions({
        environmentTerminalSessions: undefined,
        globalTerminalSessions: undefined,
        terminalTarget: {
          kind: "host_path",
          hostId: "host_1",
          cwd: "/repo",
        },
      }),
    ).toBeUndefined();
  });

  it("filters loaded host-path terminal sessions by root target", () => {
    const matching = makeTerminalSession({
      id: "term_matching",
      hostId: "host_1",
      initialCwd: "/repo",
    });
    const otherHost = makeTerminalSession({
      id: "term_other_host",
      hostId: "host_2",
      initialCwd: "/repo",
    });
    const threadTerminal = makeTerminalSession({
      id: "term_thread",
      threadId: "thr_1",
      hostId: "host_1",
      initialCwd: "/repo",
    });

    expect(
      buildRootComposeTerminalSessions({
        environmentTerminalSessions: undefined,
        globalTerminalSessions: [matching, otherHost, threadTerminal],
        terminalTarget: {
          kind: "host_path",
          hostId: "host_1",
          cwd: "/repo",
        },
      }),
    ).toEqual([matching]);
  });
});

describe("resolveRootComposePanelThreadId", () => {
  it("uses the most-recent thread from the selected reuse worktree", () => {
    expect(
      resolveRootComposePanelThreadId({
        environmentId: "env_b",
        reuseThreadOptions: [
          {
            environmentId: "env_a",
            branchName: "main",
            name: null,
            threads: [{ id: "thr_a", title: "Thread A" }],
          },
          {
            environmentId: "env_b",
            branchName: "feature",
            name: "Feature worktree",
            threads: [
              { id: "thr_b_recent", title: "Recent thread" },
              { id: "thr_b_old", title: "Old thread" },
            ],
          },
        ],
      }),
    ).toBe("thr_b_recent");
  });

  it("returns null without a selected reuse worktree", () => {
    expect(
      resolveRootComposePanelThreadId({
        environmentId: null,
        reuseThreadOptions: [
          {
            environmentId: "env_a",
            branchName: "main",
            name: null,
            threads: [{ id: "thr_a", title: "Thread A" }],
          },
        ],
      }),
    ).toBeNull();
  });
});

describe("canCreateRootComposeTerminal", () => {
  it("allows ready environments and host paths", () => {
    expect(
      canCreateRootComposeTerminal({
        terminalTarget: { kind: "environment", environmentId: "env_1" },
        environmentStatus: "ready",
      }),
    ).toBe(true);

    expect(
      canCreateRootComposeTerminal({
        terminalTarget: { kind: "environment", environmentId: "env_1" },
        environmentStatus: "provisioning",
      }),
    ).toBe(false);

    expect(
      canCreateRootComposeTerminal({
        terminalTarget: { kind: "host_path", hostId: "host_1", cwd: "/repo" },
        environmentStatus: undefined,
      }),
    ).toBe(true);

    expect(
      canCreateRootComposeTerminal({
        terminalTarget: { kind: "host_path", hostId: "host_1", cwd: null },
        environmentStatus: undefined,
      }),
    ).toBe(true);

    expect(
      canCreateRootComposeTerminal({
        terminalTarget: null,
        environmentStatus: "ready",
      }),
    ).toBe(false);
  });
});
