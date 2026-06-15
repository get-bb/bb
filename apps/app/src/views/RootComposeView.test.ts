import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import type {
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { buildMobileRecentThreads } from "./RootComposeView";

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

function makeThread(args: MakeThreadArgs): ThreadListEntry {
  return {
    id: args.id,
    projectId: args.projectId,
    environmentId: null,
    automationId: null,
    providerId: "codex",
    title: args.id,
    titleFallback: args.id,
    status: "idle",
    parentThreadId: null,
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
