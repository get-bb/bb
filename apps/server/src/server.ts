import { createNodeWebSocket } from "@hono/node-ws";
import { readFile, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { terminalWebSocketQuerySchema } from "@bb/server-contract";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import {
  buildLocalAppOrigins,
  type BuildLocalAppOriginsArgs,
} from "@bb/config/local-app-origins";
import type { AppDeps, ServerAppDeps } from "./types.js";
import { ApiError, errorToResponse } from "./errors.js";
import { registerEnvironmentRoutes } from "./routes/environments.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerHostRoutes } from "./routes/hosts.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerThreadSectionRoutes } from "./routes/thread-sections.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerTerminalRoutes } from "./routes/terminals.js";
import { registerThreadRoutes } from "./routes/threads/index.js";
import { registerPluginRoutes } from "./routes/plugins.js";
import { registerPluginCatalogRoutes } from "./routes/plugin-catalog.js";
import { registerSkillsRegistryRoutes } from "./routes/skills-registry.js";
import {
  createPluginService,
  type PluginService,
} from "./services/plugins/plugin-service.js";
import { setPluginAgentContributions } from "./services/plugins/plugin-agent-contributions.js";
import { setPluginThreadEventEmitter } from "./services/plugins/plugin-thread-events.js";
import { registerInternalEventRoutes } from "./internal/events.js";
import { registerInternalHostRoutes } from "./internal/hosts.js";
import { registerInternalInteractiveRequestRoutes } from "./internal/interactive-requests.js";
import { registerInternalPluginHostArtifactRoutes } from "./internal/plugin-host-artifacts.js";
import { registerInternalSessionRoutes } from "./internal/session.js";
import { registerInternalSkillRoutes } from "./internal/skills.js";
import { registerInternalToolCallRoutes } from "./internal/tool-calls.js";
import {
  setAuthenticatedDaemon,
  verifyAuthenticatedDaemon,
} from "./internal/auth.js";
import {
  captureTrustedRemoteAddress,
  resolveRequestAppSurface,
} from "./request-context.js";
import { runEventLoopWork } from "./services/system/event-loop-work.js";
import { runWithTelemetryAppSurface } from "./services/system/telemetry.js";
import {
  onClientSocketClose,
  onClientSocketMessage,
  onClientSocketOpen,
} from "./ws/client-protocol.js";
import {
  onDaemonSocketClose,
  onDaemonSocketMessage,
  onDaemonSocketOpen,
  validateDaemonWebSocket,
} from "./ws/daemon-protocol.js";
import { roundDurationMs } from "./services/lib/duration.js";
import {
  onTerminalSocketClose,
  onTerminalSocketMessage,
  onTerminalSocketOpen,
} from "./ws/terminal-protocol.js";
import {
  createBbAppArtifactService,
  type BbAppArtifactService,
} from "./services/install/bb-app-artifact.js";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import {
  createPluginCatalogService,
  type PluginCatalogService,
} from "./services/plugin-catalog/plugin-catalog-service.js";
import type { ProviderRegistryService } from "./services/providers/provider-registry.js";
import { callHostRetryableOnlineRpc } from "./services/hosts/online-rpc.js";
import { browserRequestProblem } from "./browser-request-guard.js";
import {
  callPluginHostRpc,
  disposePluginHostWorkers,
} from "./services/plugins/plugin-host-rpc.js";

/**
 * `/api/v1/plugins/<id>/http/...` — the plugin-owned wire, whose auth mode is
 * declared per route by the plugin itself.
 */
const PLUGIN_WIRE_HTTP_PATH = /^\/api\/v1\/plugins\/[^/]+\/http(?:\/|$)/u;
import { rankAcceptedAssetEncodings } from "./asset-content-encoding.js";
import { apiJsonCompression } from "./api-response-compression.js";

export type CloseWebSockets = () => Promise<void>;
type NodeWebSocketServer = ReturnType<typeof createNodeWebSocket>["wss"];
type WebSocketCloseError = Error | undefined;

export interface ServerApp {
  app: Hono;
  closeWebSockets: CloseWebSockets;
  injectWebSocket: ReturnType<typeof createNodeWebSocket>["injectWebSocket"];
  pluginService: PluginService;
  pluginCatalogService: PluginCatalogService;
  providerRegistry: ProviderRegistryService;
}

interface CloseWebSocketServerArgs {
  forceCloseAfterMs: number;
  reason: string;
  server: NodeWebSocketServer;
}

function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({ code: "unauthorized", message: "Unauthorized" }),
    {
      status: 401,
      headers: { "content-type": "application/json" },
    },
  );
}

function normalizeInternalAuthPath(path: string): string {
  if (path === "/") {
    return path;
  }
  return path.replace(/\/+$/u, "");
}

interface CreateAppOptions {
  bbAppArtifactService?: BbAppArtifactService;
  slowApiRequestLogThresholdMs?: number;
  staticDir?: string;
}

interface StaticResponseHeadersArgs {
  contentEncoding?: string;
  contentLength?: number;
  contentType: string;
  urlPath: string;
}

// `no-cache` (not `no-store`): the document is revalidated on every
// navigation, so a new build is picked up immediately, but WebKit may still
// keep the page in the back/forward cache and restore it without a reload.
const STATIC_INDEX_CACHE_CONTROL = "no-cache";
const STATIC_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
// Icons and manifests under public/ are not content-hashed but change only
// with a release; a day of caching keeps favicon/badge flips and PWA
// relaunches from refetching them.
const STATIC_PUBLIC_FILE_CACHE_CONTROL = "public, max-age=86400";
const WEB_SOCKET_SHUTDOWN_CODE = 1001;
const WEB_SOCKET_SHUTDOWN_FORCE_CLOSE_MS = 1_000;
const WEB_SOCKET_SHUTDOWN_REASON = "server-shutdown";
const SLOW_API_REQUEST_LOG_THRESHOLD_MS = 1_000;
const INSTALL_MACHINE_SCRIPT_PATH = fileURLToPath(
  new URL("./assets/install-machine.sh", import.meta.url),
);
const THREAD_EVENT_WAIT_PATH_PATTERN =
  /^\/api\/v1\/threads\/[^/]+\/events\/wait$/u;
const PLUGIN_APP_ASSET_PATH_PATTERN =
  /^\/api\/v1\/plugins\/[^/]+\/assets\/app\.(?:js|css)$/u;
const PRECOMPRESSED_STATIC_FILES = [
  { encoding: "br", extension: ".br" },
  { encoding: "gzip", extension: ".gz" },
] as const;

interface ShouldLogSlowApiRequestArgs {
  durationMs: number;
  path: string;
  thresholdMs: number;
}

function shouldLogSlowApiRequest(args: ShouldLogSlowApiRequestArgs): boolean {
  if (args.durationMs < args.thresholdMs) {
    return false;
  }
  return !THREAD_EVENT_WAIT_PATH_PATTERN.test(args.path);
}

function staticCacheControlForPath(urlPath: string): string {
  if (urlPath.startsWith("/assets/")) {
    return STATIC_ASSET_CACHE_CONTROL;
  }
  if (urlPath.endsWith(".html")) {
    return STATIC_INDEX_CACHE_CONTROL;
  }
  return STATIC_PUBLIC_FILE_CACHE_CONTROL;
}

function createStaticResponseHeaders(args: StaticResponseHeadersArgs): Headers {
  const headers = new Headers();
  headers.set("content-type", args.contentType);
  headers.set("cache-control", staticCacheControlForPath(args.urlPath));
  if (args.contentEncoding !== undefined) {
    headers.set("content-encoding", args.contentEncoding);
    headers.set("vary", "Accept-Encoding");
  }
  if (args.contentLength !== undefined) {
    headers.set("content-length", String(args.contentLength));
  }
  return headers;
}

function canServePrecompressedStaticFile(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType === "application/javascript" ||
    contentType === "application/json" ||
    contentType === "application/manifest+json" ||
    contentType === "application/wasm" ||
    contentType === "application/xml" ||
    contentType === "image/svg+xml"
  );
}

async function findPrecompressedStaticFile(args: {
  acceptEncodingHeader: string | undefined;
  contentType: string;
  filePath: string;
}): Promise<{
  contentLength: number;
  encoding: string;
  filePath: string;
} | null> {
  if (!canServePrecompressedStaticFile(args.contentType)) {
    return null;
  }

  for (const candidate of rankAcceptedAssetEncodings(
    args.acceptEncodingHeader,
    PRECOMPRESSED_STATIC_FILES,
  )) {
    const encodedFilePath = `${args.filePath}${candidate.extension}`;
    try {
      const encodedStat = await stat(encodedFilePath);
      if (encodedStat.isFile()) {
        return {
          contentLength: encodedStat.size,
          encoding: candidate.encoding,
          filePath: encodedFilePath,
        };
      }
    } catch {
      // Sidecar missing — try the next acceptable encoding.
    }
  }

  return null;
}

function buildAllowedCorsOrigins(deps: AppDeps): Set<string> {
  const originArgs: BuildLocalAppOriginsArgs = {
    serverPort: deps.config.serverPort,
  };
  if (deps.config.appUrl !== undefined) {
    originArgs.appUrl = deps.config.appUrl;
  }
  if (deps.config.devAppPort !== undefined) {
    originArgs.devAppPort = deps.config.devAppPort;
  }

  return new Set<string>(buildLocalAppOrigins(originArgs));
}

function closeWebSocketServer(args: CloseWebSocketServerArgs): Promise<void> {
  for (const client of args.server.clients) {
    client.close(WEB_SOCKET_SHUTDOWN_CODE, args.reason);
  }

  return new Promise<void>((resolvePromise, reject) => {
    const forceCloseTimeout = setTimeout(() => {
      for (const client of args.server.clients) {
        client.terminate();
      }
    }, args.forceCloseAfterMs);
    forceCloseTimeout.unref();

    args.server.close((error: WebSocketCloseError) => {
      clearTimeout(forceCloseTimeout);
      if (error) {
        reject(error);
        return;
      }
      resolvePromise();
    });
  });
}

export function createApp(
  deps: ServerAppDeps,
  options?: CreateAppOptions,
): ServerApp {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket, wss } = createNodeWebSocket({
    app,
  });
  const slowApiRequestLogThresholdMs =
    options?.slowApiRequestLogThresholdMs ?? SLOW_API_REQUEST_LOG_THRESHOLD_MS;
  const bbAppArtifactService =
    options?.bbAppArtifactService ??
    createBbAppArtifactService({
      dataDir: deps.config.dataDir,
      serverEntryUrl: import.meta.url,
    });

  app.use("*", async (context, next) => {
    captureTrustedRemoteAddress(context);
    const appSurface = resolveRequestAppSurface(
      context,
      deps.config.appSurface,
    );
    return runWithTelemetryAppSurface(appSurface, next);
  });
  app.use("*", async (context, next) => {
    const path = context.req.path;
    if (!path.startsWith("/api/v1/") && !path.startsWith("/internal/")) {
      return next();
    }
    return runEventLoopWork(`${context.req.method} ${path}`, next);
  });
  app.use(
    "*",
    cors({
      origin: (origin, context) => {
        const allowedCorsOrigins = buildAllowedCorsOrigins(deps);
        const requestOrigin = new URL(context.req.url).origin;
        if (origin === requestOrigin || allowedCorsOrigins.has(origin)) {
          return origin;
        }
        return null;
      },
    }),
  );
  const compressResponse = compress();
  const compressApiJson = apiJsonCompression();
  app.use("*", (context, next) => {
    // Plugin JS/CSS negotiates Brotli and gzip itself and caches immutable
    // variants. Letting this outer middleware transform an identity fallback
    // would also ignore explicit q=0 values in Hono's current parser.
    if (PLUGIN_APP_ASSET_PATH_PATTERN.test(context.req.path)) {
      return next();
    }
    // Core API JSON is buffered and Brotli-encoded (gzip fallback) with an
    // exact Content-Length by the inner middleware; the streaming gzip
    // fallback then only touches what the inner one leaves untransformed.
    return compressResponse(context, async () => {
      await compressApiJson(context, next);
    });
  });
  app.onError((error) => errorToResponse(error, deps.logger));
  app.get("/health", (context) => context.json({ ok: true }));
  app.get("/install.sh", async (context) => {
    const script = await readFile(INSTALL_MACHINE_SCRIPT_PATH);
    return new Response(script, {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/x-shellscript; charset=utf-8",
      },
    });
  });
  app.get("/install/version", async (context) => {
    return context.json({
      version: await bbAppArtifactService.getVersion(),
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
    });
  });
  // bb-app is public on npm. A paired tunnel can expose an unpublished build
  // slightly before release; serving the exact server build is an accepted
  // tradeoff so remote daemons cannot be stranded by protocol skew.
  app.get("/install/bb-app.tgz", async (context) => {
    const tarball = await readFile(await bbAppArtifactService.getTarballPath());
    return new Response(tarball, {
      headers: {
        "cache-control": "public, max-age=300",
        "content-type": "application/gzip",
      },
    });
  });
  app.use("/api/v1/*", async (context, next) => {
    const startedAt = performance.now();
    await next();
    const durationMs = performance.now() - startedAt;
    const path = context.req.path;
    if (
      shouldLogSlowApiRequest({
        durationMs,
        path,
        thresholdMs: slowApiRequestLogThresholdMs,
      })
    ) {
      deps.logger.debug(
        {
          durationMs: roundDurationMs(durationMs),
          method: context.req.method,
          path,
          status: context.res.status,
        },
        "Slow API request",
      );
    }
  });
  app.use("/api/v1/development-only/*", async (_context, next) => {
    if (!deps.config.isDevelopment) {
      throw new ApiError(404, "not_found", "Not found");
    }
    return next();
  });
  app.use("/internal/*", async (context, next) => {
    const normalizedPath = normalizeInternalAuthPath(context.req.path);
    if (normalizedPath === "/internal/hosts/enroll-key") {
      return next();
    }
    if (normalizedPath === "/internal/hosts/enroll") {
      return next();
    }
    if (normalizedPath === "/internal/ws") {
      return next();
    }
    try {
      const daemon = await verifyAuthenticatedDaemon(
        deps,
        context.req.header("authorization"),
      );
      setAuthenticatedDaemon(context, daemon);
    } catch {
      return unauthorizedResponse();
    }
    return next();
  });
  const pluginService = createPluginService({
    db: deps.db,
    hub: deps.hub,
    logger: deps.logger,
    telemetry: deps.telemetry,
    pendingInteractions: deps.pendingInteractions,
    dataDir: deps.config.dataDir,
    appVersion: deps.config.appVersion,
    sharedPorts: deps.sharedPorts,
    providerRegistry: deps.providerRegistry,
    pluginHostArtifacts: deps.pluginHostArtifacts,
    ensureSharedPortTunnel: (hostId) =>
      deps.sharedPorts.ensureTunnelIdentity(hostId, () =>
        callHostRetryableOnlineRpc(deps, {
          command: { type: "connect-tunnel.ensure-identity" },
          hostId,
          timeoutMs: 30_000,
        }),
      ),
    callPluginHost: (args) => callPluginHostRpc(deps, args),
    disposePluginHost: (args) => disposePluginHostWorkers(deps, args),
    watchBuiltinPluginSources:
      process.env.BB_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD === "1",
  });
  // Bridge the thread lifecycle seams to this service's plugins (§4.5).
  setPluginThreadEventEmitter(pluginService.events);
  // Bridge runtime-config assembly to plugin skills + context (§4.4).
  setPluginAgentContributions(pluginService);
  const publicApi = new Hono();
  // CORS decides whether a browser may *read* a response; it does not stop the
  // request being sent and acted on. A `no-cors` POST with a simple content
  // type skips the preflight entirely, and the typed route parser reads the
  // body with `c.req.json()` regardless of content type — so a page on any
  // origin could drive this API blind. Reject a foreign browser origin here
  // instead. `requireJsonForMutation` is deliberately NOT set: it answers 415
  // to any mutation without `application/json`, which would break every
  // existing `curl -d` caller. The origin check alone stops browser CSRF,
  // because a browser always sends `Origin` on a cross-origin mutation.
  // Non-browser callers (curl, the `bb` CLI, the SDK) send no `Origin` and pass
  // through untouched.
  publicApi.use("*", async (context, next) => {
    // A plugin's own HTTP routes declare their auth mode (`local` | `token` |
    // `none`). `none` is deliberately reachable from any origin, and `token`
    // authenticates with a secret rather than an origin, so this blanket check
    // must not pre-empt the per-route one `registerPluginRoutes` applies.
    if (PLUGIN_WIRE_HTTP_PATH.test(context.req.path)) {
      return next();
    }
    const problem = browserRequestProblem(context, deps);
    if (problem !== null) {
      throw new ApiError(problem.status, "forbidden_origin", problem.error);
    }
    return next();
  });
  const pluginCatalogService = createPluginCatalogService({
    db: deps.db,
    appVersion: deps.config.appVersion,
    marketplaceUrl: deps.config.marketplaceUrl,
    dataDir: deps.config.dataDir,
    plugins: pluginService,
    // The store's installed/compatible flags ride the plugin-list broadcast,
    // so a refreshed catalog reaches open windows without polling.
    notifyCatalogChanged: () => deps.hub.notifySystem(["plugins-changed"]),
    warn: (message) => deps.logger.warn(message),
  });
  registerProjectRoutes(publicApi, deps);
  registerThreadSectionRoutes(publicApi, deps);
  registerFileRoutes(publicApi, deps);
  registerHostRoutes(publicApi, deps, pluginService);
  registerTerminalRoutes(publicApi, deps);
  registerEnvironmentRoutes(publicApi, deps);
  registerThreadRoutes(publicApi, deps);
  registerSystemRoutes(publicApi, deps, pluginService);
  registerPluginCatalogRoutes(publicApi, pluginCatalogService);
  registerPluginRoutes(publicApi, deps, pluginService);
  registerSkillsRegistryRoutes(publicApi, deps);
  app.route("/api/v1", publicApi);
  app.use("/api/v1/*", () => {
    throw new ApiError(404, "not_found", "Not found");
  });

  const internalApi = new Hono();
  registerInternalHostRoutes(internalApi, deps);
  registerInternalSessionRoutes(internalApi, deps, pluginService);
  registerInternalSkillRoutes(internalApi, deps);
  registerInternalPluginHostArtifactRoutes(internalApi, deps);
  registerInternalEventRoutes(internalApi, deps);
  registerInternalToolCallRoutes(internalApi, deps);
  registerInternalInteractiveRequestRoutes(internalApi, deps);
  app.route("/internal", internalApi);

  app.get(
    "/ws",
    upgradeWebSocket((context) => {
      const problem = browserRequestProblem(context, deps);
      if (problem !== null) {
        throw new ApiError(
          problem.status,
          "forbidden_origin",
          problem.error,
          false,
        );
      }
      return {
        onOpen: (_event, socket) => onClientSocketOpen(deps.hub, socket),
        onMessage: (event, socket) =>
          onClientSocketMessage(deps, socket, event.data),
        onClose: (_event, socket) => onClientSocketClose(deps, socket),
      };
    }),
  );

  app.get(
    "/ws/terminals/:terminalId",
    upgradeWebSocket((context) => {
      const problem = browserRequestProblem(context, deps);
      if (problem !== null) {
        throw new ApiError(
          problem.status,
          "forbidden_origin",
          problem.error,
          false,
        );
      }
      const terminalId = context.req.param("terminalId");
      const query = terminalWebSocketQuerySchema.safeParse({
        sinceSeq: context.req.query("sinceSeq"),
      });
      if (!query.success) {
        throw new ApiError(
          400,
          "invalid_terminal_socket_query",
          "Terminal websocket sinceSeq must be a non-negative integer",
        );
      }
      return {
        onOpen: (_event, socket) =>
          onTerminalSocketOpen(deps, {
            socket,
            sinceSeq: query.data.sinceSeq,
            terminalId,
            threadId: null,
          }),
        onMessage: (event, socket) =>
          onTerminalSocketMessage(deps, {
            raw: event.data,
            socket,
            terminalId,
            threadId: null,
          }),
        onClose: (_event, socket) =>
          onTerminalSocketClose(deps, {
            socket,
            terminalId,
          }),
      };
    }),
  );

  app.get(
    "/internal/ws",
    upgradeWebSocket(async (context) => {
      const websocketContext = await validateDaemonWebSocket(deps, {
        authorizationHeader: context.req.header("authorization"),
        protocolHeader: context.req.header("sec-websocket-protocol"),
        sessionId: context.req.query("sessionId") ?? null,
      });
      return {
        onOpen: (_event, socket) =>
          onDaemonSocketOpen(deps, {
            ...websocketContext,
            socket,
          }),
        onMessage: (event, socket) =>
          onDaemonSocketMessage(
            deps,
            {
              hostId: websocketContext.hostId,
              raw: event.data,
              sessionId: websocketContext.sessionId,
              socket,
            },
            pluginService,
          ),
        onClose: () => onDaemonSocketClose(deps, websocketContext.sessionId),
      };
    }),
  );

  if (!options?.staticDir) {
    app.get("/", (context) => context.text("bb server"));
  }

  if (options?.staticDir) {
    const shippedRoot = resolve(options.staticDir);
    const MIME: Record<string, string> = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".webmanifest": "application/manifest+json",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".webp": "image/webp",
      ".map": "application/json",
    };

    app.get("*", async (context) => {
      const root = shippedRoot;
      const urlPath =
        context.req.path === "/" ? "/index.html" : context.req.path;
      const filePath = join(root, urlPath);
      if (!filePath.startsWith(root)) {
        return context.notFound();
      }
      try {
        const fileStat = await stat(filePath);
        if (fileStat.isFile()) {
          const contentType =
            MIME[extname(filePath)] ?? "application/octet-stream";
          const precompressedFile = await findPrecompressedStaticFile({
            acceptEncodingHeader: context.req.header("accept-encoding"),
            contentType,
            filePath,
          });
          if (precompressedFile !== null) {
            const content = await readFile(precompressedFile.filePath);
            return new Response(content, {
              headers: createStaticResponseHeaders({
                contentEncoding: precompressedFile.encoding,
                contentLength: precompressedFile.contentLength,
                contentType,
                urlPath,
              }),
            });
          }
          const content = await readFile(filePath);
          return new Response(content, {
            headers: createStaticResponseHeaders({ contentType, urlPath }),
          });
        }
      } catch {
        // File not found — fall through to SPA fallback
      }
      // /assets/ holds content-hashed build output, never a client route, so
      // a miss there is a stale reference rather than a page to render. The
      // single-page-app fallback would answer it with index.html at status
      // 200, and the browser would report a confusing MIME type error for a
      // script instead of a plain 404. Mirrors the /api/v1/* guard above.
      if (urlPath.startsWith("/assets/")) {
        return context.notFound();
      }
      const indexHtml = await readFile(join(root, "index.html"), "utf8");
      return new Response(indexHtml, {
        headers: createStaticResponseHeaders({
          contentType: "text/html",
          urlPath: "/index.html",
        }),
      });
    });
  }

  return {
    app,
    closeWebSockets: () =>
      closeWebSocketServer({
        forceCloseAfterMs: WEB_SOCKET_SHUTDOWN_FORCE_CLOSE_MS,
        reason: WEB_SOCKET_SHUTDOWN_REASON,
        server: wss,
      }),
    injectWebSocket,
    pluginService,
    pluginCatalogService,
    providerRegistry: deps.providerRegistry,
  };
}
