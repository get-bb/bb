import {
  consumePluginListingNotice,
  listPluginListingNotices,
  listPluginListings,
  type DbConnection,
} from "@bb/db";
import {
  pluginListingRecordSubmissionRequestSchema,
  pluginListingSaveDraftRequestSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { browserRequestProblem } from "../browser-request-guard.js";
import type { ServerRuntimeConfig } from "../types.js";
import {
  PluginListingConflictError,
  recordPluginListingSubmission,
  savePluginListingDraft,
} from "../services/plugins/plugin-listing-lifecycle.js";
import {
  publicMarketplaceFetch,
  type MarketplaceFetch,
} from "../services/plugin-catalog/marketplace-http.js";

interface PluginListingRoutesDeps {
  db: DbConnection;
  config: Pick<ServerRuntimeConfig, "serverPort" | "appUrl" | "devAppPort">;
  notifyChanged: () => void;
  fetch?: MarketplaceFetch;
}

export function registerPluginListingRoutes(
  app: Hono,
  deps: PluginListingRoutesDeps,
): void {
  app.get("/plugin-listings", (context) =>
    context.json({
      records: listPluginListings(deps.db),
      notices: listPluginListingNotices(deps.db),
    }),
  );

  app.post("/plugins/:id/listing/draft", async (context) => {
    const problem = browserRequestProblem(context, deps, {
      requireJsonForMutation: true,
    });
    if (problem !== null)
      return context.json({ error: problem.error }, problem.status);
    const parsed = pluginListingSaveDraftRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        { error: "a valid marketplace v2 entry is required" },
        422,
      );
    }
    try {
      const record = savePluginListingDraft({
        db: deps.db,
        pluginId: context.req.param("id"),
        entry: parsed.data.entry,
        at: Date.now(),
      });
      deps.notifyChanged();
      return context.json({ ok: true, record });
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : String(error) },
        error instanceof PluginListingConflictError ? 409 : 422,
      );
    }
  });

  app.post("/plugins/:id/listing/submission", async (context) => {
    const problem = browserRequestProblem(context, deps, {
      requireJsonForMutation: true,
    });
    if (problem !== null)
      return context.json({ error: problem.error }, problem.status);
    const parsed = pluginListingRecordSubmissionRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        {
          error:
            "a canonical BB Community marketplace pull request URL is required",
        },
        422,
      );
    }
    try {
      const record = await recordPluginListingSubmission({
        db: deps.db,
        pluginId: context.req.param("id"),
        pullRequestUrl: parsed.data.pullRequestUrl,
        fetch: deps.fetch ?? publicMarketplaceFetch,
        now: Date.now,
      });
      deps.notifyChanged();
      return context.json({ ok: true, record });
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : String(error) },
        error instanceof PluginListingConflictError ? 409 : 502,
      );
    }
  });

  app.post("/plugin-listings/notices/:noticeId/consume", (context) => {
    const problem = browserRequestProblem(context, deps, {
      requireJsonForMutation: true,
    });
    if (problem !== null)
      return context.json({ error: problem.error }, problem.status);
    const consumed = consumePluginListingNotice(
      deps.db,
      context.req.param("noticeId"),
      Date.now(),
    );
    if (consumed) deps.notifyChanged();
    return context.json({ ok: true, consumed });
  });
}
