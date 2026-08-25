import type { Hono } from "hono";
import { dispatchHoldHolderSchema } from "@bb/domain";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import {
  cancelDispatchHold,
  releaseDispatchHoldFromRequest,
} from "../services/threads/dispatch-hold-release.js";
import {
  listDispatchHoldsForApi,
  requireDispatchHold,
  requireLiveDispatchHold,
  toDispatchHoldResponse,
  updateLiveDispatchHold,
} from "../services/threads/dispatch-holds.js";

/**
 * Cross-thread hold routes. A hold id is globally unique and its row names its
 * thread, so these are addressed by hold id alone — a plugin or CLI releasing
 * a hold it was handed should not have to know which thread it belongs to.
 */
export function registerHoldRoutes(app: Hono, deps: AppDeps): void {
  const { get, post, patch } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.holds;

  get(routes.list, (context, query) => {
    const holder =
      query.holder === undefined
        ? undefined
        : dispatchHoldHolderSchema.parse(query.holder);
    return context.json(
      listDispatchHoldsForApi(deps, {
        ...(query.threadId !== undefined ? { threadId: query.threadId } : {}),
        ...(holder !== undefined ? { holder } : {}),
      }).map(toDispatchHoldResponse),
    );
  });

  get(routes.get, (context) => {
    return context.json(
      toDispatchHoldResponse(requireDispatchHold(deps, context.req.param("id"))),
    );
  });

  post(routes.release, async (context) => {
    const hold = requireLiveDispatchHold(deps, context.req.param("id"));
    if (!hold.userReleasable) {
      throw new ApiError(
        409,
        "hold_not_user_releasable",
        "This hold is owned by core and can only be cancelled",
      );
    }
    return context.json(
      toDispatchHoldResponse(
        await releaseDispatchHoldFromRequest(deps, {
          hold,
          releaseKind: "user",
        }),
      ),
    );
  });

  post(routes.cancel, async (context) => {
    const hold = requireLiveDispatchHold(deps, context.req.param("id"));
    return context.json(
      toDispatchHoldResponse(await cancelDispatchHold(deps, hold)),
    );
  });

  patch(routes.update, (context, payload) => {
    return context.json(
      toDispatchHoldResponse(
        updateLiveDispatchHold(deps, {
          holdId: context.req.param("id"),
          ...(payload.input !== undefined ? { input: payload.input } : {}),
          ...(payload.resumeAt !== undefined
            ? { resumeAt: payload.resumeAt }
            : {}),
        }),
      ),
    );
  });
}
