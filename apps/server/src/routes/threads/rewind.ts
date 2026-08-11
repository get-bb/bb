import {
  publicApiRoutes,
  typedRoutes,
  type ThreadRewindPreviewQuery,
  type PublicApiSchema,
} from "@bb/server-contract";
import { getExperiments, incrementRewindRolloutMetric } from "@bb/db";
import type { Hono } from "hono";
import type { ThreadRewindRequest } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import {
  commitThreadRewind,
  listThreadRewindBranches,
  previewThreadRewind,
  restoreThreadRewindBranch,
} from "../../services/threads/thread-rewind.js";
import { parseInteger } from "../../services/lib/validation.js";

function targetFromPreviewQuery(
  query: ThreadRewindPreviewQuery,
): ThreadRewindRequest["target"] {
  return {
    branchId: query.branchId,
    sourceSequence: parseInteger(query.sourceSequence, "sourceSequence"),
    turnId: query.turnId,
  };
}

/** Public rewind boundaries. Raw provider session/checkpoint IDs stay in DB. */
export function registerThreadRewindRoutes(app: Hono, deps: AppDeps): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.threads;

  get(routes.rewindPreview, async (context, query) => {
    const threadId = context.req.param("id");
    // Resolve the path first so a branch from another thread cannot be used as
    // an oracle for preview data, even when its branch id is otherwise valid.
    requirePublicThread(deps.db, threadId);
    return context.json(
      await previewThreadRewind(deps, {
        mode: query.mode,
        target: targetFromPreviewQuery(query),
        threadId,
      }),
    );
  });

  post(routes.rewindCommit, async (context, payload) => {
    const threadId = context.req.param("id");
    if (!getExperiments(deps.db).rewind) {
      incrementRewindRolloutMetric(deps.db, "experiment_denied");
      throw new ApiError(
        403,
        "experiment_disabled",
        "Rewind is disabled; enable the Rewind experiment to continue",
      );
    }
    requirePublicThread(deps.db, threadId);
    const request: ThreadRewindRequest = {
      editedInput: payload.editedInput,
      mode: payload.mode,
      target: payload.target,
    };
    return context.json(
      await commitThreadRewind(deps, {
        idempotencyKey: payload.idempotencyKey,
        preview: payload.preview,
        request,
        threadId,
      }),
    );
  });

  get(routes.rewindBranches, (context) => {
    const threadId = context.req.param("id");
    return context.json(listThreadRewindBranches(deps, { threadId }));
  });

  post(routes.rewindRestore, (context, payload) => {
    const threadId = context.req.param("id");
    return context.json(
      restoreThreadRewindBranch(deps, {
        branchId: payload.branchId,
        expectedActiveBranchId: payload.expectedActiveBranchId,
        threadId,
      }),
    );
  });
}
