import type {
  PromptHistoryListQuery,
  PromptHistoryListResponse,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

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
  transport,
}: CreateSdkAreaArgs): ExperimentalPromptHistoryArea {
  return {
    async list(input = {}) {
      const { signal, ...query } = input;
      return transport.readJson(
        transport.api.v1["prompt-history"].$get(
          { query },
          ...signalRequestArgs(signal),
        ),
      );
    },
  };
}
