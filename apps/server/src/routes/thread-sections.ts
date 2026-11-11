import {
  createThreadSection,
  deleteThreadSection,
  listThreadSections,
  normalizeThreadSectionName,
  renameThreadSection,
} from "@bb/db";
import { publicApiRoutes } from "@bb/server-contract";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import type { OperationRoutes } from "../kernel/http-door.js";

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

export function registerThreadSectionRoutes(
  operations: OperationRoutes,
  deps: AppDeps,
): void {
  const routes = publicApiRoutes.threadSections;

  operations.implement(routes.list, () => listThreadSections(deps.db));

  operations.implement(routes.create, (payload) => {
    const result = createThreadSection(deps.db, deps.hub, {
      name: requireSectionName(payload.name),
    });
    if (result.status === "duplicate") {
      throwDuplicateSectionName();
    }
    return result.section;
  });

  operations.implement(routes.update, (payload) => {
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
    return result.result;
  });

  operations.implement(routes.delete, (payload) => {
    const result = deleteThreadSection(deps.db, deps.hub, { id: payload.id });
    if (!result) {
      throw new ApiError(404, "section_not_found", "Section not found");
    }
    return result;
  });
}
