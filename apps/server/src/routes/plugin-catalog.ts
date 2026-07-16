import { pluginCatalogInstallRequestSchema } from "@bb/server-contract";
import type { Hono } from "hono";
import type { PluginCatalogService } from "../services/plugin-catalog/plugin-catalog-service.js";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerPluginCatalogRoutes(
  app: Hono,
  catalog: PluginCatalogService,
): void {
  app.get("/plugin-catalog", (context) =>
    context.json({ catalog: catalog.status() }),
  );

  app.get("/plugin-catalog/search", async (context) =>
    context.json({
      results: await catalog.search(context.req.query("q") ?? ""),
    }),
  );

  app.post("/plugin-catalog/install", async (context) => {
    const json: unknown = await context.req.json().catch(() => null);
    const body = pluginCatalogInstallRequestSchema.safeParse(json);
    if (!body.success) {
      return context.json({ error: 'expected { "entryId": string }' }, 422);
    }
    try {
      return context.json({
        ok: true as const,
        plugin: await catalog.install(body.data.entryId),
      });
    } catch (error) {
      return context.json({ error: message(error) }, 422);
    }
  });
}
