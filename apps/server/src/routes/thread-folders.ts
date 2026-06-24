import {
  createThreadFolder,
  deleteThreadFolder,
  normalizeThreadFolderName,
  renameThreadFolder,
} from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";

function requireFolderName(name: string): string {
  const normalized = normalizeThreadFolderName(name);
  if (!normalized) {
    throw new ApiError(400, "invalid_request", "Folder name cannot be empty");
  }
  return normalized;
}

function throwDuplicateFolderName(): never {
  throw new ApiError(409, "folder_name_conflict", "Folder name already exists");
}

export function registerThreadFolderRoutes(app: Hono, deps: AppDeps): void {
  const { del, patch, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threadFolders;

  post(routes.create, (context, payload) => {
    const result = createThreadFolder(deps.db, deps.hub, {
      name: requireFolderName(payload.name),
    });
    if (result.status === "duplicate") {
      throwDuplicateFolderName();
    }
    return context.json(result.folder, 201);
  });

  patch(routes.update, (context, payload) => {
    const result = renameThreadFolder(deps.db, deps.hub, {
      id: payload.id,
      name: requireFolderName(payload.name),
    });
    if (result.status === "not_found") {
      throw new ApiError(404, "folder_not_found", "Folder not found");
    }
    if (result.status === "duplicate") {
      throwDuplicateFolderName();
    }
    return context.json(result.result);
  });

  del(routes.delete, (context, payload) => {
    const result = deleteThreadFolder(deps.db, deps.hub, { id: payload.id });
    if (!result) {
      throw new ApiError(404, "folder_not_found", "Folder not found");
    }
    return context.json(result);
  });
}
