import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { RootComposeMobileRecents } from "./RootComposeMobileRecents";

interface MakeThreadArgs {
  id: string;
  projectId: string;
  title: string;
}

function makeThread(args: MakeThreadArgs): ThreadListEntry {
  return {
    id: args.id,
    projectId: args.projectId,
    environmentId: null,
    providerId: "codex",
    title: args.title,
    titleFallback: args.title,
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

function renderMobileRecents(threads: readonly ThreadListEntry[]): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <RootComposeMobileRecents
        highlightedThreadId={null}
        projectNamesById={
          new Map([
            [PERSONAL_PROJECT_ID, "Personal"],
            ["proj_app", "App"],
          ])
        }
        showCreatingRow={false}
        threads={threads}
      />
    </MemoryRouter>,
  );
}

describe("RootComposeMobileRecents", () => {
  it("omits the personal project label from projectless thread rows", () => {
    const markup = renderMobileRecents([
      makeThread({
        id: "thr_personal",
        projectId: PERSONAL_PROJECT_ID,
        title: "Personal thread",
      }),
      makeThread({
        id: "thr_project",
        projectId: "proj_app",
        title: "Project thread",
      }),
    ]);

    expect(markup).not.toContain(">Personal<");
    expect(markup).toContain(">App<");
  });
});
