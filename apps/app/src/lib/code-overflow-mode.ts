import type { BaseCodeOptions } from "@pierre/diffs/react";

export type CodeOverflowMode = NonNullable<BaseCodeOptions["overflow"]>;
export type CodeOverflowModeChangeHandler = (mode: CodeOverflowMode) => void;

export const DEFAULT_CODE_OVERFLOW_MODE: CodeOverflowMode = "scroll";

export function getNextCodeOverflowMode(
  mode: CodeOverflowMode,
): CodeOverflowMode {
  return mode === "wrap" ? "scroll" : "wrap";
}
