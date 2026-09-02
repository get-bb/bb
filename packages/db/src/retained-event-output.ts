import type { ThreadEventItemType } from "@bb/domain";

export const COMPLETED_EVENT_OUTPUT_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS = 32 * 1024;
export const COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS = 2 * 1024;
export const COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS = 2 * 1024;

export type RetainedEventOutputItemKind = Extract<
  ThreadEventItemType,
  "commandExecution" | "toolCall" | "webFetch" | "webSearch"
>;

export type RetainedEventOutputPath =
  | "aggregatedOutput"
  | "result"
  | "resultText";

export interface RetainedEventOutputTarget {
  itemKind: RetainedEventOutputItemKind;
  outputPath: RetainedEventOutputPath;
}

export const RETAINED_EVENT_OUTPUT_TARGETS = [
  { itemKind: "commandExecution", outputPath: "aggregatedOutput" },
  { itemKind: "toolCall", outputPath: "result" },
  { itemKind: "webFetch", outputPath: "resultText" },
  { itemKind: "webSearch", outputPath: "resultText" },
] as const satisfies readonly RetainedEventOutputTarget[];
