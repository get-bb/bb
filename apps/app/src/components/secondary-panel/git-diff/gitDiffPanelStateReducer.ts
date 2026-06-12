import type { ThreadGitDiffResponse } from "@bb/domain";
import type { ParsedGitDiffFile } from "../../git-diff/git-diff-parsing";
import type { GitDiffSelectionValue } from "./gitDiffPanelHelpers";

export type GitDiffPanelIntent =
  | {
      environmentId: string | null;
      kind: "scroll-to-file";
      path: string;
      requestId: number;
      threadId: string | null;
    }
  | {
      environmentId: string | null;
      kind: "select-commit";
      requestId: number;
      sha: string;
      threadId: string | null;
    };

export interface DisplayedGitDiffState {
  requestIdentity: string;
  response: ThreadGitDiffResponse;
}

export interface GitDiffPanelReducerState {
  displayedGitDiffState: DisplayedGitDiffState | null;
  expectedGitDiffFileCount: number;
  isParsingGitDiffFiles: boolean;
  lastFocusedScrollPath: string | null;
  lastHandledIntentRequestId: number | null;
  lastParsedGitDiffKey: string;
  parsedGitDiffFiles: ParsedGitDiffFile[];
  pendingScrollPath: string | null;
  selectedGitDiffSelection: GitDiffSelectionValue;
}

export type GitDiffPanelReducerAction =
  | { type: "environmentChanged" }
  | { type: "selectionChanged"; selection: GitDiffSelectionValue }
  | { type: "staleSelectionReset" }
  | { type: "intentReceived"; intent: GitDiffPanelIntent | null }
  | {
      type: "displayedResponseUpdated";
      requestIdentity: string;
      response: ThreadGitDiffResponse;
    }
  | { type: "displayedResponseUnavailable"; requestIdentity: string }
  | { type: "parseReset" }
  | { type: "parseEmpty"; gitDiffKey: string }
  | {
      type: "parseImmediate";
      expectedFileCount: number;
      gitDiffKey: string;
      parsedFiles: ParsedGitDiffFile[];
    }
  | {
      type: "parseBatchedStarted";
      clearFiles: boolean;
      expectedFileCount: number;
    }
  | {
      type: "parseBatchApplied";
      parsedFiles: ParsedGitDiffFile[];
      replace: boolean;
    }
  | {
      type: "parseBatchedFinished";
      expectedFileCount?: number;
      gitDiffKey: string;
      parsedFiles?: ParsedGitDiffFile[];
    }
  | { type: "scrollFocusReset" }
  | { type: "scrollFocusStarted"; path: string }
  | { type: "scrollRequestCleared" };

export const INITIAL_GIT_DIFF_PANEL_REDUCER_STATE: GitDiffPanelReducerState = {
  displayedGitDiffState: null,
  expectedGitDiffFileCount: 0,
  isParsingGitDiffFiles: false,
  lastFocusedScrollPath: null,
  lastHandledIntentRequestId: null,
  lastParsedGitDiffKey: "",
  parsedGitDiffFiles: [],
  pendingScrollPath: null,
  selectedGitDiffSelection: null,
};

export function gitDiffPanelReducer(
  state: GitDiffPanelReducerState,
  action: GitDiffPanelReducerAction,
): GitDiffPanelReducerState {
  switch (action.type) {
    case "environmentChanged":
      return {
        ...state,
        lastFocusedScrollPath: null,
        pendingScrollPath: null,
        selectedGitDiffSelection: null,
      };
    case "selectionChanged":
      return {
        ...state,
        selectedGitDiffSelection: action.selection,
      };
    case "staleSelectionReset":
      return state.selectedGitDiffSelection === null
        ? state
        : {
            ...state,
            selectedGitDiffSelection: null,
          };
    case "intentReceived": {
      if (
        action.intent === null ||
        state.lastHandledIntentRequestId === action.intent.requestId
      ) {
        return state;
      }

      if (action.intent.kind === "scroll-to-file") {
        return {
          ...state,
          lastFocusedScrollPath: null,
          lastHandledIntentRequestId: action.intent.requestId,
          pendingScrollPath: action.intent.path,
          selectedGitDiffSelection: null,
        };
      }

      return {
        ...state,
        lastFocusedScrollPath: null,
        lastHandledIntentRequestId: action.intent.requestId,
        pendingScrollPath: null,
        selectedGitDiffSelection: action.intent.sha,
      };
    }
    case "displayedResponseUpdated":
      if (
        state.displayedGitDiffState?.requestIdentity ===
          action.requestIdentity &&
        state.displayedGitDiffState.response === action.response
      ) {
        return state;
      }
      return {
        ...state,
        displayedGitDiffState: {
          requestIdentity: action.requestIdentity,
          response: action.response,
        },
      };
    case "displayedResponseUnavailable":
      return state.displayedGitDiffState?.requestIdentity ===
        action.requestIdentity
        ? state
        : {
            ...state,
            displayedGitDiffState: null,
          };
    case "parseReset":
      return {
        ...state,
        expectedGitDiffFileCount: 0,
        isParsingGitDiffFiles: false,
        lastParsedGitDiffKey: "",
        parsedGitDiffFiles: [],
      };
    case "parseEmpty":
      return {
        ...state,
        expectedGitDiffFileCount: 0,
        isParsingGitDiffFiles: false,
        lastParsedGitDiffKey: action.gitDiffKey,
        parsedGitDiffFiles: [],
      };
    case "parseImmediate":
      return {
        ...state,
        expectedGitDiffFileCount: action.expectedFileCount,
        isParsingGitDiffFiles: false,
        lastParsedGitDiffKey: action.gitDiffKey,
        parsedGitDiffFiles: action.parsedFiles,
      };
    case "parseBatchedStarted":
      return {
        ...state,
        expectedGitDiffFileCount: action.clearFiles
          ? action.expectedFileCount
          : state.expectedGitDiffFileCount,
        isParsingGitDiffFiles: true,
        parsedGitDiffFiles: action.clearFiles ? [] : state.parsedGitDiffFiles,
      };
    case "parseBatchApplied":
      return {
        ...state,
        parsedGitDiffFiles: action.replace
          ? action.parsedFiles
          : [...state.parsedGitDiffFiles, ...action.parsedFiles],
      };
    case "parseBatchedFinished":
      return {
        ...state,
        expectedGitDiffFileCount:
          action.expectedFileCount ?? state.expectedGitDiffFileCount,
        isParsingGitDiffFiles: false,
        lastParsedGitDiffKey: action.gitDiffKey,
        parsedGitDiffFiles:
          action.parsedFiles === undefined
            ? state.parsedGitDiffFiles
            : action.parsedFiles,
      };
    case "scrollFocusReset":
      return state.lastFocusedScrollPath === null
        ? state
        : {
            ...state,
            lastFocusedScrollPath: null,
        };
    case "scrollFocusStarted":
      return state.lastFocusedScrollPath === action.path
        ? state
        : {
            ...state,
            lastFocusedScrollPath: action.path,
        };
    case "scrollRequestCleared":
      return {
        ...state,
        lastFocusedScrollPath: null,
        pendingScrollPath: null,
      };
  }
}
