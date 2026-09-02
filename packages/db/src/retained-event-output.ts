import type { ThreadEventItemType } from "@bb/domain";

export type RetainedEventOutputItemKind = Extract<
  ThreadEventItemType,
  "commandExecution" | "toolCall" | "webFetch" | "webSearch"
>;

export type RetainedEventOutputPath =
  | "aggregatedOutput"
  | "result"
  | "resultText";
