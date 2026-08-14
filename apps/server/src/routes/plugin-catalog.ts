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

  // Marketplace entry icons the server fetched and validated during a refresh.
  // Serving them from BB's own origin is what keeps the app from requesting a
  // third-party URL. `?h=<content hash>` gets immutable caching; anything else
  // is no-store, so a stale URL can never pin stale bytes.
  app.get("/plugin-catalog/icons/:marketplace/:entryId", (context) => {
    const icon = catalog.icon(
      context.req.param("marketplace"),
      context.req.param("entryId"),
    );
    if (icon === undefined) {
      return context.json({ ok: false, error: "unknown catalog icon" }, 404);
    }
    return context.body(new Uint8Array(icon.bytes), 200, {
      "content-type": icon.contentType,
      "cache-control":
        context.req.query("h") === icon.hash
          ? "public, max-age=31536000, immutable"
          : "no-store",
      // Icons are inert images, but they are third-party bytes served from
      // BB's origin: forbid scripts and framing outright.
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
    });
  });

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
