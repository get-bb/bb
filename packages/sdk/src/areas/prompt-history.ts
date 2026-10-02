import type {
  PromptHistoryListQuery,
  PromptHistoryListResponse,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export type PromptHistoryListArgs = PromptHistoryListQuery & {
  signal?: AbortSignal;
};

export type PromptHistoryListResult = PromptHistoryListResponse;

export interface PromptHistoryArea {
  list(args?: PromptHistoryListArgs): Promise<PromptHistoryListResult>;
}

export function createPromptHistoryArea({
  transport,
}: CreateSdkAreaArgs): PromptHistoryArea {
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
