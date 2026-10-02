import type { Hono } from "hono";
import {
  PROMPT_HISTORY_PAGE_DEFAULT_LIMIT,
  PROMPT_HISTORY_PAGE_MAX_LIMIT,
} from "@bb/domain";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import { ApiError } from "../errors.js";
import { parseBoundedPositiveOptionalInteger } from "../services/lib/validation.js";
import {
  decodePromptHistoryCursor,
  listPromptHistory,
} from "../services/prompt-history.js";
import type { AppDeps } from "../types.js";

export function registerPromptHistoryRoutes(app: Hono, deps: AppDeps): void {
  const { get } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });

  get(publicApiRoutes.promptHistory.list, (context, query) => {
    const limit = parseBoundedPositiveOptionalInteger({
      defaultValue: PROMPT_HISTORY_PAGE_DEFAULT_LIMIT,
      max: PROMPT_HISTORY_PAGE_MAX_LIMIT,
      name: "limit",
      value: query.limit,
    });
    const before =
      query.cursor === undefined
        ? null
        : decodePromptHistoryCursor(query.cursor);
    if (query.cursor !== undefined && before === null) {
      throw new ApiError(
        400,
        "invalid_request",
        "Invalid prompt history cursor",
      );
    }
    return context.json(listPromptHistory(deps, { before, limit }));
  });
}
