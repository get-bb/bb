import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { GitDiffDisplayMode } from "@/components/secondary-panel/GitDiffToolbar";
import {
  createBooleanPreferenceAtom,
  createLocalStorageEnumStorage,
  createNullableLocalStorageEnumStorage,
} from "./browser-storage";
import {
  DEFAULT_CODE_OVERFLOW_MODE,
  type CodeOverflowMode,
} from "./code-overflow-mode";

export const GIT_DIFF_DISPLAY_MODE_STORAGE_KEY =
  "bb.thread.gitDiff.displayMode";
export const GIT_DIFF_LINE_OVERFLOW_MODE_STORAGE_KEY =
  "bb.thread.gitDiff.lineOverflowMode";
export const GIT_DIFF_IGNORE_WHITESPACE_STORAGE_KEY =
  "bb.thread.gitDiff.ignoreWhitespace";

function isGitDiffDisplayMode(value: string): value is GitDiffDisplayMode {
  return value === "unified" || value === "split";
}

function isCodeOverflowMode(value: string): value is CodeOverflowMode {
  return value === "wrap" || value === "scroll";
}

const gitDiffDisplayModePreferenceAtom =
  atomWithStorage<GitDiffDisplayMode | null>(
    GIT_DIFF_DISPLAY_MODE_STORAGE_KEY,
    null,
    createNullableLocalStorageEnumStorage(isGitDiffDisplayMode),
    { getOnInit: true },
  );

const gitDiffLineOverflowModePreferenceAtom = atomWithStorage<CodeOverflowMode>(
  GIT_DIFF_LINE_OVERFLOW_MODE_STORAGE_KEY,
  DEFAULT_CODE_OVERFLOW_MODE,
  createLocalStorageEnumStorage(isCodeOverflowMode),
  { getOnInit: true },
);

export function useGitDiffDisplayModePreference() {
  return useAtom(gitDiffDisplayModePreferenceAtom);
}

const gitDiffIgnoreWhitespacePreferenceAtom = createBooleanPreferenceAtom(
  GIT_DIFF_IGNORE_WHITESPACE_STORAGE_KEY,
  false,
);

export function useGitDiffLineOverflowModePreference() {
  return useAtom(gitDiffLineOverflowModePreferenceAtom);
}

export function useGitDiffIgnoreWhitespacePreference() {
  return useAtom(gitDiffIgnoreWhitespacePreferenceAtom);
}
