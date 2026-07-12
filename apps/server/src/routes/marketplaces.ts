import type { Hono } from "hono";
import { z } from "zod";
import {
  MarketplaceDispositionError,
  type MarketplaceService,
} from "../services/marketplaces/marketplace-service.js";

const addSchema = z
  .object({
    source: z.string().min(1),
    name: z.string().min(1).optional(),
  })
  .strict();

const dispositionsSchema = z
  .object({
    dispositions: z
      .array(
        z
          .object({
            pluginId: z.string().min(1),
            action: z.enum(["keep", "uninstall"]),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

const autoPolicySchema = z
  .object({ autoCheck: z.boolean(), autoApply: z.boolean() })
  .strict();

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerMarketplaceRoutes(
  app: Hono,
  marketplaces: MarketplaceService,
): void {
  app.post("/marketplaces", async (context) => {
    const json: unknown = await context.req.json().catch(() => null);
    const body = addSchema.safeParse(json);
    if (!body.success)
      return context.json(
        { error: 'expected { "source": string, "name"?: string }' },
        422,
      );
    try {
      return context.json(
        {
          marketplace: await marketplaces.add(body.data.source, body.data.name),
        },
        201,
      );
    } catch (error) {
      return context.json({ error: message(error) }, 422);
    }
  });

  app.get("/marketplaces", (context) =>
    context.json({ marketplaces: marketplaces.list() }),
  );

  app.get("/marketplaces/search", (context) =>
    context.json({
      results: marketplaces.search(context.req.query("q") ?? ""),
    }),
  );

  app.post("/marketplaces/:id/refresh", async (context) => {
    try {
      return context.json({
        marketplace: await marketplaces.refresh(context.req.param("id")),
      });
    } catch (error) {
      return context.json({ error: message(error) }, 422);
    }
  });

  app.post("/marketplaces/:id/auto-policy", async (context) => {
    const json: unknown = await context.req.json().catch(() => null);
    const body = autoPolicySchema.safeParse(json);
    if (!body.success) {
      return context.json(
        { error: 'expected { "autoCheck": boolean, "autoApply": boolean }' },
        422,
      );
    }
    const updated = await marketplaces.setAutoPolicy(
      context.req.param("id"),
      body.data,
    );
    if (updated === undefined) {
      return context.json({ error: "unknown marketplace" }, 404);
    }
    return context.json({
      autoCheck: updated.autoCheck,
      autoApply: updated.autoApply,
    });
  });

  app.delete("/marketplaces/:id", async (context) => {
    const json: unknown = await context.req.json().catch(() => null);
    const body = dispositionsSchema.safeParse(json);
    if (!body.success)
      return context.json(
        {
          error:
            'expected { "dispositions": [{ "pluginId": string, "action": "keep" | "uninstall" }] }',
        },
        422,
      );
    try {
      return context.json(
        await marketplaces.remove(
          context.req.param("id"),
          body.data.dispositions,
        ),
      );
    } catch (error) {
      if (error instanceof MarketplaceDispositionError) {
        return context.json(
          { error: error.message, affectedPlugins: error.affectedPlugins },
          422,
        );
      }
      return context.json({ error: message(error) }, 422);
    }
  });
}
