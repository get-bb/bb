import {
  managerTemplatesQuerySchema,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { ServerAppDeps } from "../types.js";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { ApiError } from "../errors.js";
import { queueCommandAndWait } from "../services/hosts/command-wait.js";
import { resolveSystemLookupHostId } from "../services/system/host-lookup.js";

export function registerManagerTemplateRoutes(
  app: Hono,
  deps: ServerAppDeps,
): void {
  const { get } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  get(
    "/manager-templates",
    managerTemplatesQuerySchema,
    async (context, query) => {
      const hostId = resolveSystemLookupHostId(deps, query);
      const result = await queueCommandAndWait(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: { type: "host.list_manager_templates" },
      });
      return context.json({
        templates: result.templates.map((template) => ({
          name: template.name,
          isActive: template.name === result.activeName,
        })),
        activeName: result.activeName,
      });
    },
  );
}
