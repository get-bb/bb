import type { Hono } from "hono";
import type { ServerAppDeps } from "../types.js";
import type { UiSourceService } from "../services/ui-source/ui-source.js";

/**
 * Routes for the user-editable UI source. Mounted under /api/v1. The CLI
 * (`bb ui ...`) drives these; agents in any chat call them after editing the UI
 * source on disk. Plain Hono handlers (like the static block) — this surface is
 * server-policy glue, not part of the typed product contract.
 */
export function registerUiRoutes(
  app: Hono,
  _deps: ServerAppDeps,
  uiSource: UiSourceService,
): void {
  // Attach the fork's absolute path to a result's state so the CLI can show
  // where to edit (the data dir is not otherwise exposed).
  function withSourceDir<T extends { state: object }>(result: T): T {
    return {
      ...result,
      state: { ...result.state, sourceDir: uiSource.getSourceDir() },
    };
  }

  const DISABLED = {
    ok: false as const,
    error:
      'UI forking is disabled — enable the "UI forking" experiment in Settings → Experiments.',
  };

  app.get("/ui/status", (context) =>
    context.json({
      ...uiSource.getState(),
      sourceDir: uiSource.getSourceDir(),
      enabled: uiSource.isEnabled(),
    }),
  );

  app.post("/ui/fork", async (context) => {
    if (!uiSource.isEnabled()) return context.json(DISABLED, 422);
    const reset = context.req.query("reset") === "1";
    const result = await uiSource.fork({ reset });
    return context.json(withSourceDir(result), result.ok ? 200 : 422);
  });

  app.post("/ui/apply", async (context) => {
    if (!uiSource.isEnabled()) return context.json(DISABLED, 422);
    const result = await uiSource.apply();
    return context.json(withSourceDir(result), result.ok ? 200 : 422);
  });

  app.post("/ui/prod", async (context) => context.json(await uiSource.prod()));

  app.post("/ui/update", async (context) => {
    if (!uiSource.isEnabled()) return context.json(DISABLED, 422);
    const mode = context.req.query("mode") ?? "start";
    if (mode !== "start" && mode !== "continue" && mode !== "abort") {
      return context.json(
        { ok: false, error: `invalid update mode '${mode}'` },
        400,
      );
    }
    const result = await uiSource.update(mode);
    return context.json(result, result.ok ? 200 : 422);
  });
}
