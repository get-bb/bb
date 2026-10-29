import { useCallback } from "react";
import { useLocalStorage } from "usehooks-ts";
import type { CodeOverflowMode } from "@get-bb/plugin-sdk";

export type GitDiffDisplayMode = "unified" | "split";
export type GitDiffDisplayModeChangeHandler = (
  mode: GitDiffDisplayMode,
) => void;
export type CodeOverflowModeChangeHandler = (mode: CodeOverflowMode) => void;

export const DEFAULT_CODE_OVERFLOW_MODE: CodeOverflowMode = "scroll";

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

function enumStorage<T extends string>(isValue: (value: string) => value is T) {
  return {
    serializer: (value: T | null) => value ?? "",
    deserializer: (stored: string): T | null =>
      isValue(stored) ? stored : null,
    initializeWithValue: true,
  };
}

export function useGitDiffDisplayModePreference(): [
  GitDiffDisplayMode | null,
  (mode: GitDiffDisplayMode | null) => void,
] {
  const [stored, setStored, removeStored] =
    useLocalStorage<GitDiffDisplayMode | null>(
      GIT_DIFF_DISPLAY_MODE_STORAGE_KEY,
      null,
      enumStorage(isGitDiffDisplayMode),
    );
  const setMode = useCallback(
    (mode: GitDiffDisplayMode | null) =>
      mode === null ? removeStored() : setStored(mode),
    [removeStored, setStored],
  );
  return [stored, setMode];
}

export function useGitDiffLineOverflowModePreference(): [
  CodeOverflowMode,
  CodeOverflowModeChangeHandler,
] {
  const [stored, setStored] = useLocalStorage<CodeOverflowMode | null>(
    GIT_DIFF_LINE_OVERFLOW_MODE_STORAGE_KEY,
    null,
    enumStorage(isCodeOverflowMode),
  );
  return [stored ?? DEFAULT_CODE_OVERFLOW_MODE, setStored];
}

export function useGitDiffIgnoreWhitespacePreference(): [
  boolean,
  (ignoreWhitespace: boolean) => void,
] {
  const [ignoreWhitespace, setIgnoreWhitespace] = useLocalStorage(
    GIT_DIFF_IGNORE_WHITESPACE_STORAGE_KEY,
    false,
    { initializeWithValue: true },
  );
  return [ignoreWhitespace, setIgnoreWhitespace];
}
