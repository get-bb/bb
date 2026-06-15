import type { ThreadEventItemType } from "@bb/domain";

export type StoredEventLargeValueKind =
  | "command_aggregated_output"
  | "file_change_diff"
  | "tool_result"
  | "web_fetch_result_text"
  | "web_search_result_text";

export type StoredEventLargeValueStorageKind = "json" | "text";

export type StoredEventLargeValueJsonPath =
  | "$.item.aggregatedOutput"
  | "$.item.result"
  | "$.item.resultText"
  | `$.item.changes[${number}].diff`;

export type StoredEventLargeValueTruncationPath =
  | "aggregatedOutput"
  | "result"
  | "resultText";

export type StoredEventLargeValueItemKind = Extract<
  ThreadEventItemType,
  "commandExecution" | "fileChange" | "toolCall" | "webFetch" | "webSearch"
>;
