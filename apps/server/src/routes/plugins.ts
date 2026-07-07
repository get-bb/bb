import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
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
import { parsePluginSource } from "../services/plugins/install-sources.js";
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
 * Ports BB legitimately serves the app on (server, dev app, appUrl).
 * Deliberately EXPLICIT ports only: mapping https' implicit 443 here would
 * make every ordinary internet origin match whenever appUrl is a standard
 * https URL. Standard-port deployments are covered by the exact-origin
 * allowlist instead.
 */
function knownAppPorts(deps: PluginRoutesDeps): Set<string> {
  const ports = new Set<string>([String(deps.config.serverPort)]);
  if (deps.config.devAppPort !== undefined) {
    ports.add(String(deps.config.devAppPort));
  }
  if (deps.config.appUrl !== undefined) {
    try {
      const port = new URL(deps.config.appUrl).port;
      if (port.length > 0) ports.add(port);
    } catch {
      // Ignore an unparseable appUrl; the other ports still apply.
    }
  }
  return ports;
}

/**
 * "local" auth (design §4.6): the request must come from the BB app itself.
 * The load-bearing CSRF defense is the JSON-only rule below — a cross-origin
 * JSON POST always triggers a CORS preflight, which the server's allowlist
 * denies. The Origin check adds a cheap second layer, but it must tolerate
 * BB being served over LAN/Tailscale addresses the server cannot enumerate
 * (and the dev proxy rewriting Host): any origin on a known BB app port is
 * accepted. There is deliberately NO Host allowlist — pinning Host only on
 * plugin routes adds no real protection while the rest of the local API has
 * none (a whole-server story is the actual fix; design doc §10).
 */
function localAuthProblem(
  context: Context,
  deps: PluginRoutesDeps,
): WireAuthProblem | null {
  const allowedOrigins = allowedAppOrigins(deps);
  const requestUrl = new URL(context.req.url);
  const origin = context.req.header("origin");
  if (origin !== undefined && origin !== requestUrl.origin) {
    // Only an origin with an EXPLICIT port can match the port rule —
    // implicit-port origins (ordinary internet sites) must match the exact
    // allowlist.
    let originPort: string | null = null;
    try {
      const port = new URL(origin).port;
      originPort = port.length > 0 ? port : null;
    } catch {
      originPort = null;
    }
    if (
      !allowedOrigins.has(origin) &&
      (originPort === null || !knownAppPorts(deps).has(originPort))
    ) {
      return {
        status: 403,
        error: `origin "${origin}" is not a local BB app origin`,
      };
    }
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
  const gateAllowsPlugin = (id: string): boolean =>
    plugins.isEnabled() || plugins.isBuiltin(id);
  const sourceBypassesGate = (source: string): boolean => {
    try {
      return parsePluginSource(source).kind === "builtin";
    } catch {
      return false;
    }
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
      mentionProviders: plugins.listMentionProviderContributions(),
    }),
  );

  // Composer `@`-mention search across every plugin's mention providers
  // (design §4.9). Executes plugin code, so it takes the same local-origin
  // guard as the rpc dispatcher. Registered before the /plugins/:id/*
  // routes so the static "mentions" segment cannot be captured as an id.
  app.get("/plugins/mentions/search", async (context) => {
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
    if (!gateAllowsPlugin(context.req.param("id"))) {
      return context.json(DISABLED, 422);
    }
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const id = context.req.param("id");
    const actionId = context.req.param("actionId");
    // Body first, action second: no await between lookup and invocation
    // (runThreadAction registers its in-flight marker synchronously), so a
    // reload during the body read cannot leave a stale record to run.
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

  // Frontend bundle assets (design §5.1): the app dynamic-import()s app.js
  // and links app.css from here. URLs carry ?h=<content hash> — a matching
  // hash gets immutable caching (the hash changes when the content does);
  // anything else is no-store so a stale URL can never pin a stale bundle.
  const APP_ASSET_CONTENT_TYPES = {
    "app.js": { kind: "js", contentType: "text/javascript; charset=utf-8" },
    "app.css": { kind: "css", contentType: "text/css; charset=utf-8" },
  } as const;

  app.get("/plugins/:id/assets/:file", async (context) => {
    if (!gateAllowsPlugin(context.req.param("id"))) {
      return context.json(DISABLED, 422);
    }
    const file = context.req.param("file");
    // The plugin's logo (logo.(svg|png|webp) / manifest bb.logo) and its
    // optional dark-theme variant (logo-dark.* / bb.logoDark): same
    // hash-busting cache policy and live-runtime gating as the bundle assets.
    if (file === "logo" || file === "logo-dark") {
      const logo = plugins.getLogoAsset(context.req.param("id"), file);
      if (!logo) {
        return context.json({ ok: false, error: "plugin has no logo" }, 404);
      }
      let bytes: Buffer;
      try {
        bytes = await readFile(logo.path);
      } catch {
        return context.json({ ok: false, error: "logo file missing" }, 404);
      }
      const cacheControl =
        context.req.query("h") === logo.hash
          ? "public, max-age=31536000, immutable"
          : "no-store";
      return context.body(new Uint8Array(bytes), 200, {
        "content-type": logo.contentType,
        "cache-control": cacheControl,
      });
    }
    const spec =
      file === "app.js" || file === "app.css"
        ? APP_ASSET_CONTENT_TYPES[file]
        : undefined;
    if (!spec) {
      return context.json({ ok: false, error: "unknown plugin asset" }, 404);
    }
    const asset = plugins.getAppAsset(context.req.param("id"), spec.kind);
    if (!asset) {
      return context.json(
        { ok: false, error: "plugin has no loadable frontend bundle" },
        404,
      );
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(asset.path);
    } catch {
      return context.json({ ok: false, error: "bundle file missing" }, 404);
    }
    const cacheControl =
      context.req.query("h") === asset.hash
        ? "public, max-age=31536000, immutable"
        : "no-store";
    return context.body(new Uint8Array(bytes), 200, {
      "content-type": spec.contentType,
      "cache-control": cacheControl,
    });
  });

  app.get("/plugins/:id/logs", async (context) => {
    if (!gateAllowsPlugin(context.req.param("id"))) {
      return context.json(DISABLED, 422);
    }
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
    const body = (await context.req.json().catch(() => null)) as {
      source?: unknown;
    } | null;
    if (!body || typeof body.source !== "string" || body.source.length === 0) {
      return context.json(
        { ok: false, error: "expected { source: string }" },
        400,
      );
    }
    if (!plugins.isEnabled() && !sourceBypassesGate(body.source)) {
      return context.json(DISABLED, 422);
    }
    try {
      const plugin = await plugins.install(body.source);
      return context.json({ ok: true, plugin });
    } catch (error) {
      return context.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        422,
      );
    }
  });

  app.post("/plugins/reload", async (context) => {
    const id = context.req.query("id") ?? undefined;
    if (!plugins.isEnabled() && (id === undefined || !gateAllowsPlugin(id))) {
      return context.json(DISABLED, 422);
    }
    await plugins.reload(id);
    return context.json({ ok: true, plugins: plugins.list() });
  });

  app.post("/plugins/:id/enable", async (context) => {
    if (!gateAllowsPlugin(context.req.param("id"))) {
      return context.json(DISABLED, 422);
    }
    const plugin = await plugins.setEnabled(context.req.param("id"), true);
    if (!plugin)
      return context.json({ ok: false, error: "unknown plugin" }, 404);
    return context.json({ ok: true, plugin });
  });

  app.post("/plugins/:id/disable", async (context) => {
    if (!gateAllowsPlugin(context.req.param("id"))) {
      return context.json(DISABLED, 422);
    }
    const plugin = await plugins.setEnabled(context.req.param("id"), false);
    if (!plugin)
      return context.json({ ok: false, error: "unknown plugin" }, 404);
    return context.json({ ok: true, plugin });
  });

  const NOT_RUNNING = {
    ok: false as const,
    error:
      "unknown plugin, or plugin is not running — settings exist once its factory has run",
  };

  app.get("/plugins/:id/settings", async (context) => {
    if (!gateAllowsPlugin(context.req.param("id"))) {
      return context.json(DISABLED, 422);
    }
    const view = await plugins.getSettings(context.req.param("id"));
    if (!view) return context.json(NOT_RUNNING, 404);
    return context.json({ ok: true, ...view });
  });

  app.put("/plugins/:id/settings", async (context) => {
    if (!gateAllowsPlugin(context.req.param("id"))) {
      return context.json(DISABLED, 422);
    }
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
    if (!gateAllowsPlugin(context.req.param("id"))) {
      return context.json(DISABLED, 422);
    }
    const removed = await plugins.remove(context.req.param("id"));
    if (!removed)
      return context.json({ ok: false, error: "unknown plugin" }, 404);
    return context.json({ ok: true });
  });

  app.post("/plugins/:id/token", async (context) => {
    if (!gateAllowsPlugin(context.req.param("id"))) {
      return context.json(DISABLED, 422);
    }
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
    const id = context.req.param("id");
    if (!gateAllowsPlugin(id)) return context.json(DISABLED, 422);
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
    const auth = lookup.value.auth;
    const problem =
      auth === "local"
        ? localAuthProblem(context, deps)
        : auth === "token"
          ? await tokenAuthProblem(context, plugins, id)
          : null;
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    // The token check awaited; a reload may have swapped the routing table
    // in the meantime. Re-resolve and invoke with no await in between
    // (invokeHttpRoute registers its in-flight marker synchronously) so a
    // stale handler can never run over a disposed plugin's handles. A route
    // whose auth mode changed across the reload was authenticated under the
    // old policy — refuse it rather than honoring the wrong check.
    const fresh = plugins.getHttpRoute(id, context.req.method, subPath);
    if (fresh.outcome !== "found" || fresh.value.auth !== auth) {
      return context.json(
        {
          ok: false,
          error: `plugin "${id}" reloaded during the request — retry`,
        },
        503,
      );
    }
    return plugins.invokeHttpRoute(id, fresh.value, context);
  });

  // bb.rpc dispatcher (design §4.6): always "local" auth semantics —
  // JSON-only body plus the Origin/Host check.
  app.post("/plugins/:id/rpc/:method", async (context) => {
    const id = context.req.param("id");
    if (!gateAllowsPlugin(id)) return context.json(DISABLED, 422);
    const method = context.req.param("method");
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    // Body first, handler second: the handler must be resolved with no await
    // between lookup and invocation (invokeRpcHandler registers its in-flight
    // marker synchronously), or a reload during the body read could dispose
    // the plugin after lookup and run a stale handler over closed handles.
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
