import type {
  PromptHistoryListQuery,
  PromptHistoryListResponse,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export type ExperimentalPromptHistoryListArgs = PromptHistoryListQuery & {
  signal?: AbortSignal;
};

export type ExperimentalPromptHistoryListResult = PromptHistoryListResponse;

export interface ExperimentalPromptHistoryArea {
  list(
    args?: ExperimentalPromptHistoryListArgs,
  ): Promise<ExperimentalPromptHistoryListResult>;
}

export function createPromptHistoryArea({
  operations,
}: CreateSdkAreaArgs): ExperimentalPromptHistoryArea {
  return {
    list: (input = {}) => {
      const { signal, ...query } = input;
      return operations.call("promptHistory.list", query, signal);
    },
  };
}
