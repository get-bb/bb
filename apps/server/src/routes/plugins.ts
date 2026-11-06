import { jsonBody } from "@bb/operations";
import { HOST_TAILWIND_VERSION } from "@bb/plugin-build/host-tailwind-version";
import type { PluginUpdateJobs } from "../services/plugins/plugin-update-jobs.js";
import { timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib";
import type { Context } from "hono";
import type { createNodeWebSocket } from "@hono/node-ws";
import type { WSContext, WSMessageReceive, WSEvents } from "hono/ws";
import type {
  ExperimentalPluginWebSocket,
  ExperimentalPluginWebSocketHandlers,
  PluginCliExecutionResult,
} from "@get-bb/plugin-sdk";
import type { ServerRuntimeConfig } from "../types.js";
import { ApiError, JsonBodyApiError } from "../errors.js";
import {
  browserRequestProblem,
  type BrowserRequestProblem,
} from "../browser-request-guard.js";
import type {
  PluginService,
  PluginWireLookup,
} from "../services/plugins/plugin-service.js";
import type { LoadedPlugin } from "../services/plugins/plugin-service-internal.js";
import type {
  PluginMentionTrigger,
  PluginWebSocketRouteRecord,
} from "../services/plugins/plugin-api.js";
import { PluginSettingsValidationError } from "../services/plugins/plugin-settings.js";
import { PLUGIN_RPC_CALLER_HEADER } from "../services/plugins/plugin-rpc-caller.js";
import type { PluginInstallJobs } from "../services/plugins/plugin-install-jobs.js";
import {
  prefersRespondAsync,
  respondWithInstallJob,
} from "./plugin-install-jobs.js";
import {
  createAppAssetCompressionCache,
  type AppAssetCompressionCache,
} from "../services/plugins/app-asset-compression-cache.js";
import { rankAcceptedAssetEncodings } from "../asset-content-encoding.js";
import { declineWebSocketCompression } from "../ws/compression.js";
import {
  hashedAssetCacheControl,
  pluginImageResponse,
} from "./plugin-image-response.js";
import { publicApiRoutes } from "@bb/server-contract";
import type { OperationRoutes } from "../kernel/http-door.js";

interface PluginRoutesDeps {
  config: Pick<ServerRuntimeConfig, "serverPort" | "appUrl" | "devAppPort">;
  db: import("@bb/db").DbConnection;
}

type WireAuthProblem = BrowserRequestProblem | { status: 401; error: string };
type UpgradeWebSocket = ReturnType<
  typeof createNodeWebSocket
>["upgradeWebSocket"];

const PLUGIN_CLI_KEEPALIVE_MS = 10_000;
const PLUGIN_CLI_KEEPALIVE_BYTES = new TextEncoder().encode("\n");

export async function pluginCliResponse(
  result: Promise<PluginCliExecutionResult>,
  keepaliveMs: number,
): Promise<Response> {
  const settled = result.then(
    (value) => value,
    (error: unknown): PluginCliExecutionResult => ({
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const early = await Promise.race([
    settled,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), keepaliveMs);
    }),
  ]);
  clearTimeout(timer);
  if (early !== null) {
    return Response.json(early);
  }
  let interval: ReturnType<typeof setInterval> | undefined;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(PLUGIN_CLI_KEEPALIVE_BYTES);
      interval = setInterval(() => {
        controller.enqueue(PLUGIN_CLI_KEEPALIVE_BYTES);
      }, keepaliveMs);
      void settled.then((value) => {
        clearInterval(interval);
        if (cancelled) return;
        controller.enqueue(
          new TextEncoder().encode(`${JSON.stringify(value)}\n`),
        );
        controller.close();
      });
    },
    cancel() {
      cancelled = true;
      clearInterval(interval);
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);
const MIN_COMPRESSED_APP_ASSET_BYTES = 1_024;
const MAX_CACHED_APP_ASSETS = 64;
const APP_ASSET_ENCODINGS = [
  {
    encoding: "br",
    compress: (bytes: Buffer) =>
      compressBrotli(bytes, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 6,
        },
      }),
  },
  {
    encoding: "gzip",
    compress: (bytes: Buffer) => compressGzip(bytes),
  },
] as const;

async function appAssetResponse(
  context: Context,
  bytes: Buffer,
  args: {
    assetKey: string;
    cache: AppAssetCompressionCache;
    cacheControl: string;
    contentHash: string;
    contentType: string;
  },
): Promise<Response> {
  const responseHeaders: Record<string, string> = {
    "cache-control": args.cacheControl,
    "content-length": String(bytes.length),
    "content-type": args.contentType,
  };
  if (bytes.length < MIN_COMPRESSED_APP_ASSET_BYTES) {
    return context.body(new Uint8Array(bytes), 200, responseHeaders);
  }

  responseHeaders.vary = "Accept-Encoding";
  const candidate = rankAcceptedAssetEncodings(
    context.req.header("accept-encoding"),
    APP_ASSET_ENCODINGS,
  )[0];
  if (candidate === undefined) {
    return context.body(new Uint8Array(bytes), 200, responseHeaders);
  }

  const compressed = await args.cache.getOrCreate({
    assetKey: args.assetKey,
    compress: () => candidate.compress(bytes),
    encoding: candidate.encoding,
    hash: args.contentHash,
  });
  responseHeaders["content-encoding"] = candidate.encoding;
  responseHeaders["content-length"] = String(compressed.length);
  return context.body(new Uint8Array(compressed), 200, responseHeaders);
}

function parsePluginMentionTrigger(
  value: string | undefined,
): PluginMentionTrigger | null {
  if (value === undefined) {
    return "@";
  }
  switch (value) {
    case "@":
    case "#":
    case "$":
    case "!":
    case "~":
      return value;
    default:
      return null;
  }
}

function localAuthProblem(
  context: Context,
  deps: PluginRoutesDeps,
): WireAuthProblem | null {
  return browserRequestProblem(context, deps, {
    requireJsonForMutation: true,
  });
}

function requestLocalAuthProblem(
  request: Request | null,
  deps: PluginRoutesDeps,
): WireAuthProblem | null {
  if (request === null) return null;
  return browserRequestProblem(
    {
      req: {
        url: request.url,
        method: request.method,
        header: (name) => request.headers.get(name) ?? undefined,
      },
    },
    deps,
    { requireJsonForMutation: true },
  );
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

function pluginHttpSubPath(context: Context, id: string): string {
  const prefix = `/api/v1/plugins/${id}/http`;
  const requestPath = context.req.path;
  return requestPath.startsWith(prefix)
    ? requestPath.slice(prefix.length) || "/"
    : "/";
}

function notRunningError(
  id: string,
  lookup: Extract<PluginWireLookup<unknown>, { outcome: "not-running" }>,
): string {
  const detail = lookup.detail ? ` — ${lookup.detail}` : "";
  return `plugin "${id}" is not running (status: ${lookup.status}${detail})`;
}

function pluginWebSocket(socket: WSContext): ExperimentalPluginWebSocket {
  return {
    send(data) {
      if (typeof data === "string") {
        socket.send(data);
        return;
      }
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      socket.send(copy.buffer);
    },
    close(code, reason) {
      socket.close(code, reason);
    },
    get readyState() {
      return socket.readyState;
    },
  };
}

async function pluginWebSocketMessage(
  data: WSMessageReceive,
): Promise<string | Uint8Array> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return new Uint8Array(data);
}

function pluginWebSocketError(event: Event): Error {
  if ("error" in event && event.error instanceof Error) return event.error;
  return new Error("WebSocket transport error");
}

function pluginWebSocketEvents(args: {
  handlers: ExperimentalPluginWebSocketHandlers;
  owner: LoadedPlugin;
  plugins: PluginService;
  route: PluginWebSocketRouteRecord;
}): WSEvents {
  const exposedSockets = new WeakMap<WSContext, ExperimentalPluginWebSocket>();
  const eventQueues = new WeakMap<WSContext, Promise<void>>();
  const expose = (socket: WSContext): ExperimentalPluginWebSocket => {
    const existing = exposedSockets.get(socket);
    if (existing !== undefined) return existing;
    const created = pluginWebSocket(socket);
    exposedSockets.set(socket, created);
    return created;
  };
  const invoke = (
    socket: WSContext,
    event: "open" | "message" | "close" | "error",
    run: () => void | Promise<void>,
  ): void => {
    const previous = eventQueues.get(socket) ?? Promise.resolve();
    const current = args.plugins.invokeWebSocketEvent(
      args.owner,
      args.route,
      event,
      async () => {
        await previous;
        await run();
      },
    );
    eventQueues.set(socket, current);
    void current.finally(() => {
      if (eventQueues.get(socket) === current) eventQueues.delete(socket);
    });
  };
  return {
    onOpen(_event, socket) {
      const exposed = expose(socket);
      if (!args.route.active) {
        exposed.close(1012, "Plugin reloaded or disabled");
        return;
      }
      args.route.sockets.add(exposed);
      if (args.handlers.onOpen !== undefined) {
        invoke(socket, "open", () => args.handlers.onOpen?.(exposed));
      }
    },
    onMessage(event, socket) {
      const exposed = expose(socket);
      if (
        !args.route.active ||
        !args.route.sockets.has(exposed) ||
        args.handlers.onMessage === undefined
      ) {
        return;
      }
      invoke(socket, "message", async () =>
        args.handlers.onMessage?.(
          exposed,
          await pluginWebSocketMessage(event.data),
        ),
      );
    },
    onClose(event, socket) {
      const exposed = expose(socket);
      if (!args.route.sockets.delete(exposed)) return;
      if (args.handlers.onClose !== undefined) {
        invoke(socket, "close", () =>
          args.handlers.onClose?.(exposed, {
            code: event.code,
            reason: event.reason,
          }),
        );
      }
    },
    onError(event, socket) {
      if (args.handlers.onError === undefined) return;
      const exposed = expose(socket);
      invoke(socket, "error", () =>
        args.handlers.onError?.(exposed, pluginWebSocketError(event)),
      );
    },
  };
}

export function registerPluginRoutes(
  routes: OperationRoutes,
  deps: PluginRoutesDeps,
  plugins: PluginService,
  installJobs: PluginInstallJobs,
  updateJobs: PluginUpdateJobs,
  upgradeWebSocket?: UpgradeWebSocket,
): void {
  const app = routes.app;
  const contract = publicApiRoutes.plugins;
  const appAssetCompressionCache = createAppAssetCompressionCache(
    MAX_CACHED_APP_ASSETS,
  );
  const upgradePluginWebSocket = upgradeWebSocket?.(async (context) => {
    declineWebSocketCompression(context);
    const id = context.req.param("id");
    if (id === undefined) {
      throw new ApiError(404, "unknown_plugin", "missing plugin id");
    }
    const subPath = pluginHttpSubPath(context, id);
    const lookup = plugins.getWebSocketRoute(id, subPath);
    if (lookup.outcome === "unknown-plugin") {
      throw new ApiError(404, "unknown_plugin", `unknown plugin "${id}"`);
    }
    if (lookup.outcome === "not-running") {
      throw new ApiError(
        503,
        "plugin_not_running",
        notRunningError(id, lookup),
      );
    }
    if (lookup.outcome === "not-found") {
      throw new ApiError(
        404,
        "unknown_plugin_websocket",
        `plugin "${id}" has no websocket route for "${subPath}"`,
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
      throw new ApiError(
        problem.status,
        "plugin_websocket_unauthorized",
        problem.error,
      );
    }
    const fresh = plugins.getWebSocketRoute(id, subPath);
    if (fresh.outcome !== "found" || fresh.value.auth !== auth) {
      throw new ApiError(
        503,
        "plugin_reloaded",
        `plugin "${id}" reloaded during the request — retry`,
      );
    }
    const result = await plugins.invokeWebSocketRoute(
      fresh.owner,
      fresh.value,
      {
        request: context.req.raw,
        url: new URL(context.req.url),
        headers: context.req.raw.headers,
      },
    );
    if (!result.ok) {
      throw new ApiError(
        500,
        "plugin_websocket_failed",
        `plugin websocket failed: ${result.error}`,
      );
    }
    return pluginWebSocketEvents({
      handlers: result.handlers,
      owner: fresh.owner,
      plugins,
      route: fresh.value,
    });
  });

  routes.implement(contract.discoverRpc, (query) => plugins.discoverRpc(query));

  routes.implement(contract.list, () => ({ plugins: plugins.list() }));

  routes.implement(contract.contributions, () => ({
    cliCommands: plugins.listCliContributions(),
    mentionProviders: plugins.listMentionProviderContributions(),
  }));

  routes.implement(contract.searchMentions, async (query, { request }) => {
    const problem = requestLocalAuthProblem(request, deps);
    if (problem) {
      throw new JsonBodyApiError(problem.status, {
        ok: false,
        error: problem.error,
      });
    }
    const text = (query.q ?? "").trim();
    if (text.length === 0) {
      return { ok: true as const, groups: [] };
    }
    const projectId = query.projectId ?? null;
    const threadId = query.threadId ?? null;
    const trigger = parsePluginMentionTrigger(query.trigger);
    if (trigger === null) {
      throw new JsonBodyApiError(400, {
        ok: false,
        error: `invalid plugin mention trigger ${JSON.stringify(query.trigger)}`,
      });
    }
    const groups = await plugins.searchMentions({
      trigger,
      query: text,
      projectId: projectId !== null && projectId.length > 0 ? projectId : null,
      threadId: threadId !== null && threadId.length > 0 ? threadId : null,
    });
    return { ok: true as const, groups };
  });

  app.post("/plugins/:id/cli", async (context) => {
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
    const ctx: {
      cwd?: string;
      threadId?: string;
      projectId?: string;
      signal?: AbortSignal;
    } = {};
    if (typeof body?.cwd === "string") ctx.cwd = body.cwd;
    if (typeof body?.threadId === "string") ctx.threadId = body.threadId;
    if (typeof body?.projectId === "string") ctx.projectId = body.projectId;
    ctx.signal = context.req.raw.signal;
    return pluginCliResponse(
      plugins.runCliCommand(context.req.param("id"), argv, ctx),
      PLUGIN_CLI_KEEPALIVE_MS,
    );
  });

  const APP_ASSET_CONTENT_TYPES = {
    "app.js": { kind: "js", contentType: "text/javascript; charset=utf-8" },
    "app.css": { kind: "css", contentType: "text/css; charset=utf-8" },
  } as const;

  app.get("/plugin-app-assets/:hash/:file", async (context) => {
    const file = context.req.param("file");
    const spec =
      file === "app.js" || file === "app.css"
        ? APP_ASSET_CONTENT_TYPES[file]
        : undefined;
    if (!spec) {
      return context.json({ ok: false, error: "unknown plugin asset" }, 404);
    }
    const hash = context.req.param("hash");
    if (!/^[a-f0-9]{16}$/u.test(hash)) {
      return context.json({ ok: false, error: "unknown plugin asset" }, 404);
    }
    const asset = plugins.getAppAssetByHash(hash, spec.kind);
    if (!asset) {
      return context.json(
        { ok: false, error: "plugin has no loadable frontend bundle" },
        404,
      );
    }
    const hostTailwind =
      spec.kind === "css" &&
      context.req.query("host-tailwind") === HOST_TAILWIND_VERSION;
    const ownedRoot =
      spec.kind === "css" && context.req.query("css-scope") === "owned-root-v1";
    let bytes: Buffer;
    try {
      bytes = await asset.read({ hostTailwind, ownedRoot });
    } catch {
      return context.json({ ok: false, error: "bundle file missing" }, 404);
    }
    return appAssetResponse(context, bytes, {
      assetKey: `${hash}:${spec.kind}:${hostTailwind}:${ownedRoot}`,
      cache: appAssetCompressionCache,
      contentType: spec.contentType,
      cacheControl: "public, max-age=31536000, immutable",
      contentHash: asset.hash,
    });
  });

  app.get("/plugins/:id/assets/icons/:file", (context) => {
    const file = context.req.param("file");
    const name = file.endsWith(".svg") ? file.slice(0, -".svg".length) : null;
    const asset =
      name === null || name.length === 0
        ? undefined
        : plugins.getIconAsset(context.req.param("id"), name);
    if (!asset) {
      return context.json({ ok: false, error: "plugin has no such icon" }, 404);
    }
    return pluginImageResponse(
      context,
      asset,
      hashedAssetCacheControl(context.req.query("h"), asset.hash),
    );
  });

  app.get("/plugins/:id/assets/:file", async (context) => {
    const file = context.req.param("file");
    if (file === "icon" || file === "logo" || file === "logo-dark") {
      const asset = plugins.getBrandingAsset(context.req.param("id"), file);
      if (!asset) {
        return context.json(
          { ok: false, error: "plugin has no requested branding asset" },
          404,
        );
      }
      return pluginImageResponse(
        context,
        asset,
        hashedAssetCacheControl(context.req.query("h"), asset.hash),
      );
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
    const hostTailwind =
      spec.kind === "css" &&
      context.req.query("host-tailwind") === HOST_TAILWIND_VERSION;
    const ownedRoot =
      spec.kind === "css" && context.req.query("css-scope") === "owned-root-v1";
    let bytes: Buffer;
    try {
      bytes = await asset.read({ hostTailwind, ownedRoot });
    } catch {
      return context.json({ ok: false, error: "bundle file missing" }, 404);
    }
    const cacheControl = hashedAssetCacheControl(
      context.req.query("h"),
      asset.hash,
    );
    return appAssetResponse(context, bytes, {
      assetKey: `${context.req.param("id")}:${spec.kind}:${hostTailwind}:${ownedRoot}`,
      cache: appAssetCompressionCache,
      contentType: spec.contentType,
      cacheControl,
      contentHash: asset.hash,
    });
  });

  routes.implement(contract.logs, async ({ id, tail: requestedTail }) => {
    const rawTail = Number(requestedTail ?? "100");
    const tail = Number.isFinite(rawTail)
      ? Math.min(Math.max(Math.trunc(rawTail), 1), 10_000)
      : 100;
    const lines = await plugins.readLogTail(id, tail);
    if (lines === undefined) {
      throw new JsonBodyApiError(404, { ok: false, error: "unknown plugin" });
    }
    return { ok: true as const, lines };
  });

  routes.implement(contract.checkUpdates, async ({ id }) => {
    try {
      return { results: await plugins.checkForUpdates(id) };
    } catch (error) {
      throw new JsonBodyApiError(422, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  routes.implement(contract.updates, () => {
    try {
      return { results: plugins.listUpdateResults() };
    } catch (error) {
      throw new JsonBodyApiError(422, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  routes.implement(contract.pruneCache, ({ dryRun }) =>
    plugins.pruneCache({ dryRun }),
  );

  routes.implement(
    contract.applyUpdate,
    async ({ id: pluginId }, { request }) => {
      const job = updateJobs.start({
        pluginId,
        displayName: plugins.getDisplayName(pluginId),
        run: async () => {
          const outcome = await plugins.applyUpdate(pluginId);
          if (!outcome.ok) throw new Error(outcome.error);
          return outcome.result;
        },
      });
      if (prefersRespondAsync(request)) {
        return jsonBody({ job }, { status: 202 });
      }
      const settled = (await updateJobs.settled(job.id)) ?? job;
      if (settled.state === "completed") return settled.result;
      throw new JsonBodyApiError(422, {
        error:
          settled.state === "failed"
            ? settled.error
            : "update did not complete",
      });
    },
  );

  routes.implement(
    contract.install,
    async ({ source, selection }, { request }) => {
      const problem = requestLocalAuthProblem(request, deps);
      if (problem) {
        throw new JsonBodyApiError(problem.status, {
          ok: false,
          error: problem.error,
        });
      }
      const job = installJobs.start({
        target: { kind: "source", source, selection },
        displayName: source,
        run: () => plugins.install(source, selection),
      });
      return respondWithInstallJob(request, installJobs, job, (error) => ({
        ok: false,
        error,
      }));
    },
  );

  routes.implement(contract.source, async ({ id }) => {
    const source = await plugins.getSource(id);
    if (source === undefined) {
      throw new JsonBodyApiError(404, { error: "unknown plugin" });
    }
    return source;
  });

  routes.implement(contract.reload, async ({ id }) => {
    const outcome = await plugins.reload(id);
    if (!outcome.ok) throw new JsonBodyApiError(422, { ...outcome });
    return outcome;
  });

  routes.implement(contract.safeMode, () => ({
    enabled: plugins.getSafeMode(),
  }));

  routes.implement(contract.setSafeMode, ({ enabled }) =>
    plugins.setSafeMode(enabled),
  );

  for (const [route, enabled] of [
    [contract.enable, true],
    [contract.disable, false],
  ] as const) {
    routes.implement(route, async ({ id }) => {
      const plugin = await plugins.setEnabled(id, enabled);
      if (!plugin) {
        throw new JsonBodyApiError(404, { ok: false, error: "unknown plugin" });
      }
      return { ok: true as const, plugin };
    });
  }

  const NOT_RUNNING = {
    ok: false as const,
    error:
      "unknown plugin, or plugin is not running — settings exist once its factory has run",
  };

  routes.implement(contract.settings, async ({ id }) => {
    const view = await plugins.getSettings(id);
    if (!view) throw new JsonBodyApiError(404, NOT_RUNNING);
    return { ok: true as const, ...view };
  });

  routes.implement(contract.updateSettings, async ({ id, values }) => {
    try {
      const view = await plugins.updateSettings(id, values);
      if (!view) throw new JsonBodyApiError(404, NOT_RUNNING);
      return { ok: true as const, ...view };
    } catch (error) {
      if (error instanceof PluginSettingsValidationError) {
        throw new JsonBodyApiError(400, { ok: false, error: error.message });
      }
      throw error;
    }
  });

  routes.implement(contract.remove, async ({ id }) => {
    if (plugins.isBuiltin(id)) {
      throw new JsonBodyApiError(409, {
        ok: false,
        error: "Built-in plugins can be disabled, but not deleted.",
      });
    }
    const removed = await plugins.remove(id);
    if (!removed) {
      throw new JsonBodyApiError(404, { ok: false, error: "unknown plugin" });
    }
    return { ok: true as const };
  });

  routes.implement(contract.token, async ({ id, rotate }) => {
    const token = await plugins.httpToken(id, { rotate });
    if (token === undefined) {
      throw new JsonBodyApiError(404, { ok: false, error: "unknown plugin" });
    }
    return { ok: true as const, token };
  });

  if (upgradePluginWebSocket !== undefined) {
    app.get("/plugins/:id/http/*", (context, next) =>
      context.req.header("upgrade")?.toLowerCase() === "websocket"
        ? upgradePluginWebSocket(context, next)
        : next(),
    );
  }

  app.all("/plugins/:id/http/*", async (context) => {
    const id = context.req.param("id");
    const subPath = pluginHttpSubPath(context, id);
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
    return plugins.invokeHttpRoute(fresh.owner, fresh.value, context);
  });

  app.post("/plugins/:id/rpc/:method", async (context) => {
    const id = context.req.param("id");
    const method = context.req.param("method");
    context.header("Cache-Control", "no-store");
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const callerResolution = plugins.resolveRpcCaller(
      context.req.header(PLUGIN_RPC_CALLER_HEADER),
    );
    if (!callerResolution.ok) {
      return context.json(
        {
          ok: false,
          error: `the ${PLUGIN_RPC_CALLER_HEADER} token isn't a running plugin's caller token`,
        },
        403,
      );
    }
    const rawBody = await context.req.text();
    let input: unknown;
    if (rawBody.length > 0) {
      try {
        input = JSON.parse(rawBody);
      } catch {
        return context.json(
          {
            ok: false,
            error: {
              code: "invalid_json",
              message: "request body must be JSON (the rpc input)",
            },
          },
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
        {
          ok: false,
          error: {
            code: "unknown_method",
            message: `plugin "${id}" has no rpc method "${method}"`,
          },
        },
        404,
      );
    }
    const outcome = await plugins.invokeRpcHandler(
      lookup.owner,
      method,
      lookup.value,
      input,
      callerResolution.caller,
      context.req.raw.signal,
    );
    if (!outcome.ok) {
      return context.json(
        { ok: false, error: outcome.error },
        (
          {
            invalid_json: 400,
            invalid_input: 400,
            forbidden: 403,
            not_found: 404,
            conflict: 409,
            invalid: 422,
            handler_error: 500,
            invalid_output: 500,
            non_json_result: 500,
            unknown_method: 404,
            transport_error: 500,
            invalid_response: 500,
            unknown_error: 500,
          } as const
        )[outcome.error.code],
      );
    }
    return context.json({ ok: true, result: outcome.result });
  });
}
