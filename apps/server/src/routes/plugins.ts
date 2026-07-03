import { timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import {
  buildLocalAppOrigins,
  type BuildLocalAppOriginsArgs,
} from "@bb/config/local-app-origins";
import type { ServerRuntimeConfig } from "../types.js";
import type {
  PluginService,
  PluginWireLookup,
} from "../services/plugins/plugin-service.js";
import { PluginSettingsValidationError } from "../services/plugins/plugin-settings.js";

/** The slice of server deps the "local" auth checks need (origin allowlist). */
export interface PluginRoutesDeps {
  config: Pick<ServerRuntimeConfig, "serverPort" | "appUrl" | "devAppPort">;
}

interface WireAuthProblem {
  status: 401 | 403 | 415;
  error: string;
}

/** Same allowlist the CORS middleware enforces (server.ts), per request. */
function allowedAppOrigins(deps: PluginRoutesDeps): Set<string> {
  const args: BuildLocalAppOriginsArgs = {
    serverPort: deps.config.serverPort,
  };
  if (deps.config.appUrl !== undefined) args.appUrl = deps.config.appUrl;
  if (deps.config.devAppPort !== undefined) {
    args.devAppPort = deps.config.devAppPort;
  }
  return new Set(buildLocalAppOrigins(args));
}

/**
 * "local" auth (design §4.6): the request must come from the local BB app.
 * Origin (when present) must be an allowed app origin, Host must be a local
 * app host (blunts CSRF and DNS rebinding), and non-GET requests must carry
 * a JSON content type so browsers are forced into a CORS preflight the
 * allowlist denies.
 */
function localAuthProblem(
  context: Context,
  deps: PluginRoutesDeps,
): WireAuthProblem | null {
  const allowedOrigins = allowedAppOrigins(deps);
  const requestUrl = new URL(context.req.url);
  const origin = context.req.header("origin");
  if (
    origin !== undefined &&
    origin !== requestUrl.origin &&
    !allowedOrigins.has(origin)
  ) {
    return {
      status: 403,
      error: `origin "${origin}" is not a local BB app origin`,
    };
  }
  const allowedHosts = new Set(
    [...allowedOrigins].map((allowed) => new URL(allowed).host),
  );
  if (!allowedHosts.has(requestUrl.host)) {
    return {
      status: 403,
      error: `host "${requestUrl.host}" is not a local BB app host`,
    };
  }
  const method = context.req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const contentType = context.req.header("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return {
        status: 415,
        error: "content-type must be application/json",
      };
    }
  }
  return null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

/** "token" auth: x-bb-plugin-token header or ?token= must match the plugin's secret. */
async function tokenAuthProblem(
  context: Context,
  plugins: PluginService,
  id: string,
): Promise<WireAuthProblem | null> {
  const presented =
    context.req.header("x-bb-plugin-token") ?? context.req.query("token");
  const expected = await plugins.httpToken(id);
  if (
    expected === undefined ||
    presented === undefined ||
    !timingSafeEqualStrings(presented, expected)
  ) {
    return {
      status: 401,
      error:
        'missing or invalid plugin token — send it as the "x-bb-plugin-token" header ' +
        "or ?token=; print it with `bb plugin token " +
        `${id}\``,
    };
  }
  return null;
}

function notRunningError(
  id: string,
  lookup: Extract<PluginWireLookup<unknown>, { outcome: "not-running" }>,
): string {
  const detail = lookup.detail ? ` — ${lookup.detail}` : "";
  return `plugin "${id}" is not running (status: ${lookup.status}${detail})`;
}

/**
 * Plugin management routes plus the boot-time wire dispatchers
 * (/plugins/:id/http/* and /plugins/:id/rpc/:method). Mounted under /api/v1
 * before the catch-all; dispatch goes through the plugin service's live
 * routing tables so reload swaps handlers without re-registering Hono
 * routes. Plain Hono handlers (like the ui-source routes) — this surface is
 * server-policy glue, not part of the typed product contract.
 */
export function registerPluginRoutes(
  app: Hono,
  deps: PluginRoutesDeps,
  plugins: PluginService,
): void {
  const DISABLED = {
    ok: false as const,
    error:
      'Plugins are disabled — enable the "Plugins" experiment in Settings → Experiments.',
  };

  app.get("/plugins", (context) =>
    context.json({ enabled: plugins.isEnabled(), plugins: plugins.list() }),
  );

  // Fast metadata for the bb CLI's help/proxy path and the app's
  // host-rendered UI contributions: no plugin code runs; empty (not an
  // error) while the experiment is off.
  app.get("/plugins/contributions", (context) =>
    context.json({
      cliCommands: plugins.listCliContributions(),
      threadActions: plugins.listThreadActionContributions(),
      slashCommands: plugins.listSlashCommandContributions(),
      mentionProviders: plugins.listMentionProviderContributions(),
    }),
  );

  // Composer `@`-mention search across every plugin's mention providers
  // (design §4.9). Executes plugin code, so it takes the same local-origin
  // guard as the rpc dispatcher. Registered before the /plugins/:id/*
  // routes so the static "mentions" segment cannot be captured as an id.
  app.get("/plugins/mentions/search", async (context) => {
    if (!plugins.isEnabled()) return context.json(DISABLED, 422);
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const query = (context.req.query("q") ?? "").trim();
    if (query.length === 0) {
      return context.json({ ok: true, groups: [] });
    }
    const projectId = context.req.query("projectId") ?? null;
    const threadId = context.req.query("threadId") ?? null;
    const groups = await plugins.searchMentions({
      query,
      projectId: projectId !== null && projectId.length > 0 ? projectId : null,
      threadId: threadId !== null && threadId.length > 0 ? threadId : null,
    });
    return context.json({ ok: true, groups });
  });

  // Proxied `bb <plugin-command>` / `bb plugin run` invocation (design §4.4).
  // Dispatch problems come back as { exitCode: 1, stderr } rather than HTTP
  // errors so the CLI can uniformly print stderr and exit with exitCode.
  app.post("/plugins/:id/cli", async (context) => {
    // Same local-origin/CSRF guard as the rpc dispatcher: this route executes
    // plugin code with full server capabilities, so a cross-origin simple
    // POST must not reach it. The bb CLI sends application/json from
    // loopback, which passes.
    const authProblem = localAuthProblem(context, deps);
    if (authProblem) {
      return context.json(
        { ok: false, error: authProblem.error },
        authProblem.status,
      );
    }
    const body = (await context.req.json().catch(() => null)) as {
      argv?: unknown;
      cwd?: unknown;
      threadId?: unknown;
      projectId?: unknown;
    } | null;
    const argv = body?.argv;
    if (!isStringArray(argv)) {
      return context.json(
        { ok: false, error: "expected { argv: string[] }" },
        400,
      );
    }
    const ctx: { cwd?: string; threadId?: string; projectId?: string } = {};
    if (typeof body?.cwd === "string") ctx.cwd = body.cwd;
    if (typeof body?.threadId === "string") ctx.threadId = body.threadId;
    if (typeof body?.projectId === "string") ctx.projectId = body.projectId;
    const result = await plugins.runCliCommand(
      context.req.param("id"),
      argv,
      ctx,
    );
    return context.json(result);
  });

  // Host-rendered thread action invocation (design §4.9). Executes plugin
  // code with full server capabilities, so it takes the same local-origin
  // guard as the rpc dispatcher.
  app.post("/plugins/:id/actions/:actionId", async (context) => {
    if (!plugins.isEnabled()) return context.json(DISABLED, 422);
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const id = context.req.param("id");
    const actionId = context.req.param("actionId");
    const lookup = plugins.getThreadAction(id, actionId);
    if (lookup.outcome === "unknown-plugin") {
      return context.json({ ok: false, error: `unknown plugin "${id}"` }, 404);
    }
    if (lookup.outcome === "not-running") {
      return context.json(
        { ok: false, error: notRunningError(id, lookup) },
        503,
      );
    }
    if (lookup.outcome === "not-found") {
      return context.json(
        {
          ok: false,
          error: `plugin "${id}" has no thread action "${actionId}"`,
        },
        404,
      );
    }
    const body = (await context.req.json().catch(() => null)) as {
      threadId?: unknown;
    } | null;
    const threadId = body?.threadId;
    if (typeof threadId !== "string" || threadId.length === 0) {
      return context.json(
        { ok: false, error: "expected { threadId: string }" },
        400,
      );
    }
    const result = await plugins.runThreadAction(id, lookup.value, threadId);
    if (result.outcome === "unknown-thread") {
      return context.json(
        { ok: false, error: `unknown thread "${threadId}"` },
        404,
      );
    }
    if (result.outcome === "error") {
      return context.json({ ok: false, error: result.error }, 500);
    }
    return context.json(
      result.toast ? { ok: true, toast: result.toast } : { ok: true },
    );
  });

  // Composer slash-command invocation (design §4.9). Executes plugin code
  // with full server capabilities, so it takes the same local-origin guard
  // as the rpc dispatcher. threadId/projectId are null when the command runs
  // from the homepage (new-thread) composer.
  app.post("/plugins/:id/slash/:name", async (context) => {
    if (!plugins.isEnabled()) return context.json(DISABLED, 422);
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const id = context.req.param("id");
    const name = context.req.param("name");
    const lookup = plugins.getSlashCommand(id, name);
    if (lookup.outcome === "unknown-plugin") {
      return context.json({ ok: false, error: `unknown plugin "${id}"` }, 404);
    }
    if (lookup.outcome === "not-running") {
      return context.json(
        { ok: false, error: notRunningError(id, lookup) },
        503,
      );
    }
    if (lookup.outcome === "not-found") {
      return context.json(
        { ok: false, error: `plugin "${id}" has no slash command "${name}"` },
        404,
      );
    }
    const body = (await context.req.json().catch(() => null)) as {
      args?: unknown;
      threadId?: unknown;
      projectId?: unknown;
    } | null;
    const args = body?.args === undefined ? "" : body.args;
    const threadId = body?.threadId === undefined ? null : body.threadId;
    const projectId = body?.projectId === undefined ? null : body.projectId;
    if (
      typeof args !== "string" ||
      (threadId !== null && typeof threadId !== "string") ||
      (projectId !== null && typeof projectId !== "string")
    ) {
      return context.json(
        {
          ok: false,
          error: "expected { args?: string, threadId?: string, projectId?: string }",
        },
        400,
      );
    }
    const result = await plugins.runSlashCommand(id, lookup.value, {
      args,
      threadId,
      projectId,
    });
    if (result.outcome === "error") {
      return context.json({ ok: false, error: result.error }, 500);
    }
    return context.json({ ok: true, ...result.value });
  });

  app.get("/plugins/:id/logs", async (context) => {
    if (!plugins.isEnabled()) return context.json(DISABLED, 422);
    const rawTail = Number(context.req.query("tail") ?? "100");
    const tail = Number.isFinite(rawTail)
      ? Math.min(Math.max(Math.trunc(rawTail), 1), 10_000)
      : 100;
    const lines = await plugins.readLogTail(context.req.param("id"), tail);
    if (lines === undefined) {
      return context.json({ ok: false, error: "unknown plugin" }, 404);
    }
    return context.json({ ok: true, lines });
  });

  // Body: { source: "path:<dir>" | "git:<url>@<ref>" | "npm:<name>@<version>" }
  // (bare paths are treated as path: sources).
  app.post("/plugins/install", async (context) => {
    if (!plugins.isEnabled()) return context.json(DISABLED, 422);
    const body = (await context.req.json().catch(() => null)) as {
      source?: unknown;
    } | null;
    if (!body || typeof body.source !== "string" || body.source.length === 0) {
      return context.json(
        { ok: false, error: "expected { source: string }" },
        400,
      );
    }
    try {
      const plugin = await plugins.install(body.source);
      return context.json({ ok: true, plugin });
    } catch (error) {
      return context.json(
        { ok: false, error: error instanceof Error ? error.message : String(error) },
        422,
      );
    }
  });

  app.post("/plugins/reload", async (context) => {
    if (!plugins.isEnabled()) return context.json(DISABLED, 422);
    const id = context.req.query("id") ?? undefined;
    await plugins.reload(id);
    return context.json({ ok: true, plugins: plugins.list() });
  });

  app.post("/plugins/:id/enable", async (context) => {
    if (!plugins.isEnabled()) return context.json(DISABLED, 422);
    const plugin = await plugins.setEnabled(context.req.param("id"), true);
    if (!plugin) return context.json({ ok: false, error: "unknown plugin" }, 404);
    return context.json({ ok: true, plugin });
  });

  app.post("/plugins/:id/disable", async (context) => {
    if (!plugins.isEnabled()) return context.json(DISABLED, 422);
    const plugin = await plugins.setEnabled(context.req.param("id"), false);
    if (!plugin) return context.json({ ok: false, error: "unknown plugin" }, 404);
    return context.json({ ok: true, plugin });
  });

  const NOT_RUNNING = {
    ok: false as const,
    error:
      "unknown plugin, or plugin is not running — settings exist once its factory has run",
  };

  app.get("/plugins/:id/settings", async (context) => {
    if (!plugins.isEnabled()) return context.json(DISABLED, 422);
    const view = await plugins.getSettings(context.req.param("id"));
    if (!view) return context.json(NOT_RUNNING, 404);
    return context.json({ ok: true, ...view });
  });

  app.put("/plugins/:id/settings", async (context) => {
    if (!plugins.isEnabled()) return context.json(DISABLED, 422);
    const body = (await context.req.json().catch(() => null)) as {
      values?: unknown;
    } | null;
    const values = body?.values;
    if (
      values === undefined ||
      values === null ||
      typeof values !== "object" ||
      Array.isArray(values)
    ) {
      return context.json(
        { ok: false, error: "expected { values: Record<string, unknown> }" },
        400,
      );
    }
    try {
      const view = await plugins.updateSettings(
        context.req.param("id"),
        values as Record<string, unknown>,
      );
      if (!view) return context.json(NOT_RUNNING, 404);
      return context.json({ ok: true, ...view });
    } catch (error) {
      if (error instanceof PluginSettingsValidationError) {
        return context.json({ ok: false, error: error.message }, 400);
      }
      throw error;
    }
  });

  app.delete("/plugins/:id", async (context) => {
    if (!plugins.isEnabled()) return context.json(DISABLED, 422);
    const removed = await plugins.remove(context.req.param("id"));
    if (!removed) return context.json({ ok: false, error: "unknown plugin" }, 404);
    return context.json({ ok: true });
  });

  app.post("/plugins/:id/token", async (context) => {
    if (!plugins.isEnabled()) return context.json(DISABLED, 422);
    const body = (await context.req.json().catch(() => null)) as {
      rotate?: unknown;
    } | null;
    const token = await plugins.httpToken(context.req.param("id"), {
      rotate: body?.rotate === true,
    });
    if (token === undefined) {
      return context.json({ ok: false, error: "unknown plugin" }, 404);
    }
    return context.json({ ok: true, token });
  });

  // Boot-time dispatcher for bb.http routes (design §4.6): Hono routes
  // cannot be added or removed after boot, so one wildcard route dispatches
  // through the live per-plugin route table (exact method+path match).
  app.all("/plugins/:id/http/*", async (context) => {
    if (!plugins.isEnabled()) return context.json(DISABLED, 422);
    const id = context.req.param("id");
    const prefix = `/api/v1/plugins/${id}/http`;
    const requestPath = context.req.path;
    const subPath = requestPath.startsWith(prefix)
      ? requestPath.slice(prefix.length) || "/"
      : "/";
    const lookup = plugins.getHttpRoute(id, context.req.method, subPath);
    if (lookup.outcome === "unknown-plugin") {
      return context.json({ ok: false, error: `unknown plugin "${id}"` }, 404);
    }
    if (lookup.outcome === "not-running") {
      return context.json(
        { ok: false, error: notRunningError(id, lookup) },
        503,
      );
    }
    if (lookup.outcome === "not-found") {
      return context.json(
        {
          ok: false,
          error: `plugin "${id}" has no ${context.req.method} route for "${subPath}"`,
        },
        404,
      );
    }
    const route = lookup.value;
    const problem =
      route.auth === "local"
        ? localAuthProblem(context, deps)
        : route.auth === "token"
          ? await tokenAuthProblem(context, plugins, id)
          : null;
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    return plugins.invokeHttpRoute(id, route, context);
  });

  // bb.rpc dispatcher (design §4.6): always "local" auth semantics —
  // JSON-only body plus the Origin/Host check.
  app.post("/plugins/:id/rpc/:method", async (context) => {
    if (!plugins.isEnabled()) return context.json(DISABLED, 422);
    const id = context.req.param("id");
    const method = context.req.param("method");
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const lookup = plugins.getRpcHandler(id, method);
    if (lookup.outcome === "unknown-plugin") {
      return context.json({ ok: false, error: `unknown plugin "${id}"` }, 404);
    }
    if (lookup.outcome === "not-running") {
      return context.json(
        { ok: false, error: notRunningError(id, lookup) },
        503,
      );
    }
    if (lookup.outcome === "not-found") {
      return context.json(
        { ok: false, error: `plugin "${id}" has no rpc method "${method}"` },
        404,
      );
    }
    const rawBody = await context.req.text();
    let input: unknown;
    if (rawBody.length > 0) {
      try {
        input = JSON.parse(rawBody);
      } catch {
        return context.json(
          { ok: false, error: "request body must be JSON (the rpc input)" },
          400,
        );
      }
    }
    const outcome = await plugins.invokeRpcHandler(
      id,
      method,
      lookup.value,
      input,
    );
    if (!outcome.ok) {
      return context.json({ ok: false, error: outcome.error }, 500);
    }
    return context.json({ ok: true, result: outcome.result });
  });
}
