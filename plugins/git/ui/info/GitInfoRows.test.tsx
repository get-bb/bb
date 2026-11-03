// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { makeWorkspaceMergeBase, makeWorkspaceStatus } from "../../testing.js";
import { formatBranchComparison, GitStatusRowView } from "./GitInfoRows.js";

installTestPluginRuntime();

function renderRow(
  props: Parameters<typeof GitStatusRowView>[0],
): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <GitStatusRowView {...props} />
    </TooltipProvider>,
  );
}

describe("GitStatusRowView", () => {
  it("qualifies counts when squash detection is incomplete", () => {
    const markup = renderRow({
      workspace: makeWorkspaceStatus({
        mergeBase: makeWorkspaceMergeBase({
          aheadCount: 3,
          squashMergeCheckComplete: false,
        }),
      }),
      failure: undefined,
      errorMessage: null,
    });
    expect(markup).toContain("3 ahead of main");
    expect(markup).toContain(
      'aria-label="Squash-merge check incomplete; counts may include already-merged commits."',
    );
  });

  it("compares the branch with the merge base the host reported", () => {
    const render = (
      mergeBase: ReturnType<typeof makeWorkspaceMergeBase> | null,
    ) =>
      renderRow({
        workspace: makeWorkspaceStatus({ mergeBase }),
        failure: undefined,
        errorMessage: null,
      });
    expect(
      render(
        makeWorkspaceMergeBase({ mergeBaseBranch: "release", aheadCount: 2 }),
      ),
    ).toContain("2 ahead of release");
    expect(render(null)).toBe("");
  });

  it("keeps the last known comparison when a refresh fails and flags it as stale", () => {
    const render = (errorMessage: string | null) =>
      renderRow({
        workspace: makeWorkspaceStatus({
          mergeBase: makeWorkspaceMergeBase({
            mergeBaseBranch: "main",
            aheadCount: 3,
          }),
        }),
        failure: undefined,
        errorMessage,
      });
    const stale = render("Workspace status unavailable.");
    expect(stale).toContain("3 ahead of main");
    expect(stale).toContain(
      "Couldn&#x27;t refresh: Workspace status unavailable. Showing the last known status.",
    );
    expect(render(null)).not.toContain("Couldn&#x27;t refresh");
  });

  it("shows the failure when no status has loaded", () => {
    expect(
      renderRow({
        workspace: undefined,
        failure: undefined,
        errorMessage: "Workspace status unavailable.",
      }),
    ).toContain("Workspace status unavailable");
    expect(
      renderRow({
        workspace: undefined,
        failure: {
          code: "path_not_found",
          workspacePath: "/tmp/workspace",
          message: "No such directory",
        },
        errorMessage: null,
      }),
    ).toContain("Workspace not found");
    expect(
      renderRow({ workspace: undefined, failure: undefined, errorMessage: null }),
    ).toBe("");
  });

  it("phrases the branch comparison against its merge base", () => {
    const compare = (aheadCount: number, behindCount: number) =>
      formatBranchComparison({ aheadCount, behindCount, baseBranch: "main" });
    expect(compare(0, 0)).toBe("Even with main");
    expect(compare(6, 0)).toBe("6 ahead of main");
    expect(compare(0, 3)).toBe("3 behind main");
    expect(compare(4, 2)).toBe("4 ahead, 2 behind main");
  });
});
