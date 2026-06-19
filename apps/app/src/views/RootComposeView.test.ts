import {
  PERSONAL_PROJECT_ID,
  type ProjectSource,
  type ThreadListEntry,
} from "@bb/domain";
import type {
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import type { ReuseThreadOption } from "@/components/pickers/WorktreePicker";
import {
  buildMobileRecentThreads,
  readInitialPromptFromLocationState,
  resolveRootComposeEffectiveEnvironmentValue,
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

describe("buildMobileRecentThreads", () => {
  it("includes projectless and every project thread", () => {
    const sidebarNavigation: SidebarBootstrapResponse = {
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
        initialPrompt: "Create a new bb automation to ",
      }),
    ).toBe("Create a new bb automation to ");
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
