import { deleteDraft, listDrafts, updateDraft } from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import {
  createDraftResource,
  draftStorageFields,
  requireDraft,
  requireDraftRevision,
  toDraft,
} from "../services/drafts/draft-records.js";
import { submitDraft } from "../services/drafts/draft-submit.js";

function pageNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ApiError(400, "invalid_request", "Invalid draft pagination");
  }
  return parsed;
}

export function registerDraftRoutes(app: Hono, deps: AppDeps): void {
  const { get, post, patch, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.drafts;

  post(routes.open, (context, payload) => {
    const draft = requireDraft(deps, context.req.param("id"));
    const delivered = deps.hub.notifyDraftOpen(
      draft.id,
      payload.split ?? "replace",
    );
    return context.json({ delivered });
  });

  post(routes.create, (context, payload) =>
    context.json(createDraftResource(deps, payload), 201),
  );

  get(routes.list, (context, query) => {
    const limit = pageNumber(query.limit, 50);
    const offset = pageNumber(query.offset, 0);
    if (limit < 1 || limit > 200) {
      throw new ApiError(400, "invalid_request", "Draft limit must be 1–200");
    }
    const rows = listDrafts(deps.db, {
      projectId: query.projectId,
      query: query.query,
      includeEmpty: query.includeEmpty === "true",
      limit: limit + 1,
      offset,
    });
    return context.json({
      drafts: rows.slice(0, limit).map(toDraft),
      nextOffset: rows.length > limit ? offset + limit : null,
    });
  });

  get(routes.get, (context) =>
    context.json(requireDraft(deps, context.req.param("id"))),
  );

  patch(routes.update, (context, payload) => {
    const id = context.req.param("id");
    requireDraftRevision(deps, id, payload.expectedRevision);
    const row = updateDraft(deps.db, {
      id,
      expectedRevision: payload.expectedRevision,
      ...draftStorageFields(payload.content),
    });
    if (row === null) {
      throw new ApiError(409, "draft_revision_conflict", "Draft changed");
    }
    deps.hub.notifySystem(["drafts-changed"]);
    return context.json(toDraft(row));
  });

  del(routes.delete, (context, payload) => {
    const id = context.req.param("id");
    requireDraftRevision(deps, id, payload.expectedRevision);
    const row = deleteDraft(deps.db, {
      id,
      expectedRevision: payload.expectedRevision,
    });
    if (row === null) {
      throw new ApiError(409, "draft_revision_conflict", "Draft changed");
    }
    deps.hub.notifySystem(["drafts-changed"]);
    return context.json({ id, revision: row.revision });
  });

  post(routes.submit, async (context, payload) =>
    context.json(
      await submitDraft(deps, {
        draftId: context.req.param("id"),
        revision: payload.expectedRevision,
        origin: payload.origin,
        ...(payload.originPluginId !== undefined
          ? { originPluginId: payload.originPluginId }
          : {}),
      }),
    ),
  );
}
