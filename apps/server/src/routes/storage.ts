import type { Hono } from "hono";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import { ApiError } from "../errors.js";
import { readDatabaseStorage } from "../services/system/database-storage.js";
import type { AppDeps } from "../types.js";

export function registerStorageRoutes(app: Hono, deps: AppDeps): void {
  const { get } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });

  get(publicApiRoutes.storage.database, async (context) =>
    context.json(await readDatabaseStorage(deps.db)),
  );
}
