import type { PromptHistoryPosition } from "@bb/db";
import {
  PROMPT_HISTORY_PAGE_DEFAULT_LIMIT,
  PROMPT_HISTORY_PAGE_MAX_LIMIT,
} from "@bb/domain";
import { publicApiRoutes } from "@bb/server-contract";
import { ApiError } from "../errors.js";
import type { OperationRoutes } from "../kernel/http-door.js";
import { parseBoundedPositiveOptionalInteger } from "../services/lib/validation.js";
import {
  decodePromptHistoryCursor,
  listPromptHistory,
} from "../services/prompt-history.js";
import type { AppDeps } from "../types.js";

export function registerPromptHistoryRoutes(
  routes: OperationRoutes,
  deps: AppDeps,
): void {
  routes.implement(publicApiRoutes.promptHistory.list, (query) => {
    const limit = parseBoundedPositiveOptionalInteger({
      defaultValue: PROMPT_HISTORY_PAGE_DEFAULT_LIMIT,
      max: PROMPT_HISTORY_PAGE_MAX_LIMIT,
      name: "limit",
      value: query.limit,
    });
    let before: PromptHistoryPosition | null = null;
    if (query.cursor !== undefined) {
      before = decodePromptHistoryCursor(query.cursor);
      if (before === null) {
        throw new ApiError(
          400,
          "invalid_request",
          "Invalid prompt history cursor",
        );
      }
    }
    return listPromptHistory(deps, { before, limit });
  });
}
