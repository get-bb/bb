import {
  createThreadSection,
  deleteThreadSection,
  normalizeThreadSectionName,
  renameThreadSection,
} from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";

function requireSectionName(name: string): string {
  const normalized = normalizeThreadSectionName(name);
  if (!normalized) {
    throw new ApiError(400, "invalid_request", "Section name cannot be empty");
  }
  return normalized;
}

function throwDuplicateSectionName(): never {
  throw new ApiError(
    409,
    "section_name_conflict",
    "Section name already exists",
  );
}

export function registerThreadSectionRoutes(app: Hono, deps: AppDeps): void {
  const { del, patch, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threadSections;

  post(routes.create, (context, payload) => {
    const result = createThreadSection(deps.db, deps.hub, {
      name: requireSectionName(payload.name),
    });
    if (result.status === "duplicate") {
      throwDuplicateSectionName();
    }
    return context.json(result.section, 201);
  });

  patch(routes.update, (context, payload) => {
    const result = renameThreadSection(deps.db, deps.hub, {
      id: payload.id,
      name: requireSectionName(payload.name),
    });
    if (result.status === "not_found") {
      throw new ApiError(404, "section_not_found", "Section not found");
    }
    if (result.status === "duplicate") {
      throwDuplicateSectionName();
    }
    return context.json(result.result);
  });

  del(routes.delete, (context, payload) => {
    const result = deleteThreadSection(deps.db, deps.hub, { id: payload.id });
    if (!result) {
      throw new ApiError(404, "section_not_found", "Section not found");
    }
    return context.json(result);
  });
}
