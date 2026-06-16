import { describe, expect, it } from "vitest";
import type { ThreadGitDiffResponse } from "@bb/domain";
import { parseGitDiffFiles } from "../../git-diff/git-diff-parsing";
import {
  gitDiffPanelReducer,
  INITIAL_GIT_DIFF_PANEL_REDUCER_STATE,
  type GitDiffPanelReducerAction,
  type GitDiffPanelReducerState,
} from "./gitDiffPanelStateReducer";

const SAMPLE_DIFF = [
  "diff --git a/src/file.ts b/src/file.ts",
  "--- a/src/file.ts",
  "+++ b/src/file.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
].join("\n");

function makeDiffResponse(diff: string): ThreadGitDiffResponse {
  return {
    diff,
    files: "M\tsrc/file.ts\n",
    mergeBaseRef: "abc1234",
    shortstat: " 1 file changed, 1 insertion(+), 1 deletion(-)",
    truncated: false,
  };
}

function reduce(
  state: GitDiffPanelReducerState,
  actions: GitDiffPanelReducerAction[],
): GitDiffPanelReducerState {
  return actions.reduce(gitDiffPanelReducer, state);
}

describe("gitDiffPanelStateReducer", () => {
  it("turns scroll and commit intents into explicit reducer state", () => {
    const scrollState = gitDiffPanelReducer(
      {
        ...INITIAL_GIT_DIFF_PANEL_REDUCER_STATE,
        selectedGitDiffSelection: "commit-a",
      },
      {
        type: "intentReceived",
        intent: {
          environmentId: "env-1",
          kind: "scroll-to-file",
          path: "src/file.ts",
          requestId: 1,
          threadId: "thread-1",
        },
      },
    );

    expect(scrollState.pendingScrollPath).toBe("src/file.ts");
    expect(scrollState.selectedGitDiffSelection).toBeNull();

    const ignoredDuplicate = gitDiffPanelReducer(scrollState, {
      type: "intentReceived",
      intent: {
        environmentId: "env-1",
        kind: "select-commit",
        requestId: 1,
        sha: "commit-b",
        threadId: "thread-1",
      },
    });
    expect(ignoredDuplicate).toBe(scrollState);

    const commitState = gitDiffPanelReducer(scrollState, {
      type: "intentReceived",
      intent: {
        environmentId: "env-1",
        kind: "select-commit",
        requestId: 2,
        sha: "commit-b",
        threadId: "thread-1",
      },
    });
    expect(commitState.pendingScrollPath).toBeNull();
    expect(commitState.selectedGitDiffSelection).toBe("commit-b");
  });

  it("clears environment-scoped selection and pending scroll state", () => {
    const state = gitDiffPanelReducer(
      {
        ...INITIAL_GIT_DIFF_PANEL_REDUCER_STATE,
        lastFocusedScrollPath: "src/file.ts",
        pendingScrollPath: "src/file.ts",
        selectedGitDiffSelection: "commit-a",
      },
      { type: "environmentChanged" },
    );

    expect(state.lastFocusedScrollPath).toBeNull();
    expect(state.pendingScrollPath).toBeNull();
    expect(state.selectedGitDiffSelection).toBeNull();
  });

  it("retains or drops displayed responses by request identity", () => {
    const response = makeDiffResponse(SAMPLE_DIFF);
    const state = gitDiffPanelReducer(INITIAL_GIT_DIFF_PANEL_REDUCER_STATE, {
      type: "displayedResponseUpdated",
      requestIdentity: "env-1:all:main",
      response,
    });

    expect(state.displayedGitDiffState?.response).toBe(response);
    expect(
      gitDiffPanelReducer(state, {
        type: "displayedResponseUnavailable",
        requestIdentity: "env-1:all:main",
      }).displayedGitDiffState,
    ).toBe(state.displayedGitDiffState);
    expect(
      gitDiffPanelReducer(state, {
        type: "displayedResponseUnavailable",
        requestIdentity: "env-1:commit:abc",
      }).displayedGitDiffState,
    ).toBeNull();
  });

  it("models reset, immediate, and batched parse transitions", () => {
    const parsedFiles = parseGitDiffFiles(SAMPLE_DIFF);
    const parsedState = reduce(INITIAL_GIT_DIFF_PANEL_REDUCER_STATE, [
      {
        type: "parseImmediate",
        expectedFileCount: 1,
        gitDiffKey: "diff-key",
        parsedFiles,
      },
      {
        type: "parseBatchedStarted",
        clearFiles: false,
        expectedFileCount: 2,
      },
      {
        type: "parseBatchedFinished",
        expectedFileCount: 2,
        gitDiffKey: "next-diff-key",
        parsedFiles,
      },
    ]);

    expect(parsedState.isParsingGitDiffFiles).toBe(false);
    expect(parsedState.expectedGitDiffFileCount).toBe(2);
    expect(parsedState.lastParsedGitDiffKey).toBe("next-diff-key");
    expect(parsedState.parsedGitDiffFiles).toBe(parsedFiles);

    const resetState = gitDiffPanelReducer(parsedState, { type: "parseReset" });
    expect(resetState.parsedGitDiffFiles).toEqual([]);
    expect(resetState.lastParsedGitDiffKey).toBe("");
  });
});
