import {
  createThreadFolder,
  deleteThreadFolder,
  isThreadFolderDescendantPath,
  normalizeThreadFolderPath,
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

export function registerThreadFolderRoutes(app: Hono, deps: AppDeps): void {
  const { del, patch, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threadFolders;

  post(routes.create, (context, payload) => {
    const path = normalizeThreadFolderPath(payload.path);
    if (!path) {
      throw new ApiError(400, "invalid_request", "Folder name cannot be empty");
    }
    return context.json(createThreadFolder(deps.db, deps.hub, { path }), 201);
  });

  patch(routes.update, (context, payload) => {
    const path = normalizeThreadFolderPath(payload.path);
    const newPath = normalizeThreadFolderPath(payload.newPath);
    if (!path || !newPath) {
      throw new ApiError(400, "invalid_request", "Folder name cannot be empty");
    }
    if (isThreadFolderDescendantPath(path, newPath)) {
      throw new ApiError(
        400,
        "invalid_request",
        "Folder cannot be moved into one of its subfolders",
      );
    }
    const result = renameThreadFolder(deps.db, deps.hub, {
      path,
      newPath,
    });
    if (!result) {
      throw new ApiError(404, "folder_not_found", "Folder not found");
    }
    return context.json(result);
  });

  del(routes.delete, (context, payload) => {
    const path = normalizeThreadFolderPath(payload.path);
    if (!path) {
      throw new ApiError(400, "invalid_request", "Folder name cannot be empty");
    }
    const result = deleteThreadFolder(deps.db, deps.hub, { path });
    if (!result) {
      throw new ApiError(404, "folder_not_found", "Folder not found");
    }
    return context.json(result);
  });
}
