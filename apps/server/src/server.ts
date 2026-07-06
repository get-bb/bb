import { createNodeWebSocket } from "@hono/node-ws";
import { readFile, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { extname, join, resolve } from "node:path";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import {
  buildLocalAppOrigins,
  type BuildLocalAppOriginsArgs,
} from "@bb/config/local-app-origins";
import { getExperiments } from "@bb/db";
import type { AppDeps, ServerAppDeps } from "./types.js";
import { ApiError, errorToResponse } from "./errors.js";
import { registerEnvironmentRoutes } from "./routes/environments.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerHostRoutes } from "./routes/hosts.js";
import { registerConnectRoutes } from "./routes/connect.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerThreadFolderRoutes } from "./routes/thread-folders.js";
import { registerAutomationRoutes } from "./routes/automations.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerTerminalRoutes } from "./routes/terminals.js";
import { registerThreadRoutes } from "./routes/threads/index.js";
import { registerUiRoutes } from "./routes/ui.js";
import { registerPluginRoutes } from "./routes/plugins.js";
import {
  createPluginService,
  type PluginService,
} from "./services/plugins/plugin-service.js";
import { setPluginAgentContributions } from "./services/plugins/plugin-agent-contributions.js";
import { setPluginThreadEventEmitter } from "./services/plugins/plugin-thread-events.js";
import { createUiSourceService } from "./services/ui-source/ui-source.js";
import { injectRecoveryShim } from "./services/ui-source/recovery-shim.js";
import { registerInternalEventRoutes } from "./internal/events.js";
import { registerInternalHostRoutes } from "./internal/hosts.js";
import { registerInternalInteractiveRequestRoutes } from "./internal/interactive-requests.js";
import { registerInternalSessionRoutes } from "./internal/session.js";
import { registerInternalToolCallRoutes } from "./internal/tool-calls.js";
import {
  setAuthenticatedDaemon,
  verifyAuthenticatedDaemon,
} from "./internal/auth.js";
import {
  captureTrustedRemoteAddress,
  resolveRequestAppSurface,
} from "./request-context.js";
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

export type CloseWebSockets = () => Promise<void>;
type NodeWebSocketServer = ReturnType<typeof createNodeWebSocket>["wss"];
type WebSocketCloseError = Error | undefined;

export interface ServerApp {
  app: Hono;
  closeWebSockets: CloseWebSockets;
  injectWebSocket: ReturnType<typeof createNodeWebSocket>["injectWebSocket"];
  pluginService: PluginService;
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
  slowApiRequestLogThresholdMs?: number;
  staticDir?: string;
  /**
   * Directory holding the shipped app source (with vite.ui.config.ts), used to
   * seed and build the user-editable UI source. When set, the `/api/v1/ui/*`
   * routes are enabled and static serving can swap to the built UI source.
   */
  appDir?: string;
  /** Directory holding the @bb/* packages as source (defaults to <appDir>/../../packages). */
  packagesSourceDir?: string;
  /** Fetch the shipped source before seeding (packaged install clones the release tag). */
  ensureUiSource?: () => Promise<{ ok: boolean; log: string }>;
}

interface StaticResponseHeadersArgs {
  contentEncoding?: string;
  contentLength?: number;
  contentType: string;
  urlPath: string;
}

const STATIC_INDEX_CACHE_CONTROL = "no-store";
const STATIC_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const WEB_SOCKET_SHUTDOWN_CODE = 1001;
const WEB_SOCKET_SHUTDOWN_FORCE_CLOSE_MS = 1_000;
const WEB_SOCKET_SHUTDOWN_REASON = "server-shutdown";
const SLOW_API_REQUEST_LOG_THRESHOLD_MS = 1_000;
const THREAD_EVENT_WAIT_PATH_PATTERN =
  /^\/api\/v1\/threads\/[^/]+\/events\/wait$/u;
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

function createStaticResponseHeaders(args: StaticResponseHeadersArgs): Headers {
  const headers = new Headers();
  headers.set("content-type", args.contentType);
  headers.set(
    "cache-control",
    args.urlPath.startsWith("/assets/")
      ? STATIC_ASSET_CACHE_CONTROL
      : STATIC_INDEX_CACHE_CONTROL,
  );
  if (args.contentEncoding !== undefined) {
    headers.set("content-encoding", args.contentEncoding);
    headers.set("vary", "Accept-Encoding");
  }
  if (args.contentLength !== undefined) {
    headers.set("content-length", String(args.contentLength));
  }
  return headers;
}

function acceptedEncodingQuality(
  acceptEncodingHeader: string | undefined,
  encoding: string,
): number {
  if (acceptEncodingHeader === undefined) {
    return 0;
  }
  let wildcardQuality = 0;
  for (const part of acceptEncodingHeader.split(",")) {
    const [rawName, ...rawParams] = part.trim().split(";");
    const name = rawName?.trim().toLowerCase();
    const qParam = rawParams
      .map((param) => param.trim().toLowerCase())
      .find((param) => param.startsWith("q="));
    const quality =
      qParam === undefined
        ? 1
        : Number.isNaN(Number(qParam.slice(2)))
          ? 1
          : Number(qParam.slice(2));
    if (name === encoding) {
      return quality;
    }
    if (name === "*") {
      wildcardQuality = quality;
    }
  }
  return wildcardQuality;
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

  const candidates = PRECOMPRESSED_STATIC_FILES.map((candidate, index) => ({
    ...candidate,
    index,
    quality: acceptedEncodingQuality(
      args.acceptEncodingHeader,
      candidate.encoding,
    ),
  }))
    .filter((candidate) => candidate.quality > 0)
    .sort(
      (left, right) => right.quality - left.quality || left.index - right.index,
    );

  for (const candidate of candidates) {
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

  app.use("*", async (context, next) => {
    captureTrustedRemoteAddress(context);
    const appSurface = resolveRequestAppSurface(context, deps.config.appSurface);
    return runWithTelemetryAppSurface(appSurface, next);
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
  app.use("*", compress());
  app.onError((error) => errorToResponse(error, deps.logger));
  app.get("/health", (context) => context.json({ ok: true }));
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
    dataDir: deps.config.dataDir,
    appVersion: deps.config.appVersion,
    isEnabled: () => getExperiments(deps.db).plugins,
  });
  // Bridge the thread lifecycle seams to this service's plugins (§4.5).
  setPluginThreadEventEmitter(pluginService.events);
  // Bridge runtime-config assembly to plugin skills + context (§4.4).
  setPluginAgentContributions(pluginService);
  const publicApi = new Hono();
  registerProjectRoutes(publicApi, deps);
  registerThreadFolderRoutes(publicApi, deps);
  registerAutomationRoutes(publicApi, deps);
  registerFileRoutes(publicApi, deps);
  registerHostRoutes(publicApi, deps);
  registerConnectRoutes(publicApi, deps);
  registerTerminalRoutes(publicApi, deps);
  registerEnvironmentRoutes(publicApi, deps);
  registerThreadRoutes(publicApi, deps);
  registerSystemRoutes(publicApi, deps, pluginService);
  registerPluginRoutes(publicApi, deps, pluginService);
  const uiSource = options?.appDir
    ? createUiSourceService({
        dataDir: deps.config.dataDir,
        appDir: options.appDir,
        packagesSourceDir: options.packagesSourceDir,
        ensureSource: options.ensureUiSource,
        hub: deps.hub,
        logger: deps.logger,
        version: deps.config.appVersion,
        isEnabled: () => getExperiments(deps.db).uiForking,
      })
    : undefined;
  if (uiSource) {
    registerUiRoutes(publicApi, deps, uiSource);
  }
  app.route("/api/v1", publicApi);
  app.use("/api/v1/*", () => {
    throw new ApiError(404, "not_found", "Not found");
  });

  const internalApi = new Hono();
  registerInternalHostRoutes(internalApi, deps);
  registerInternalSessionRoutes(internalApi, deps);
  registerInternalEventRoutes(internalApi, deps);
  registerInternalToolCallRoutes(internalApi, deps);
  registerInternalInteractiveRequestRoutes(internalApi, deps);
  app.route("/internal", internalApi);

  app.get(
    "/ws",
    upgradeWebSocket(() => ({
      onOpen: (_event, socket) => onClientSocketOpen(deps.hub, socket),
      onMessage: (event, socket) =>
        onClientSocketMessage(deps, socket, event.data),
      onClose: (_event, socket) => onClientSocketClose(deps, socket),
    })),
  );

  app.get(
    "/ws/terminals/:terminalId",
    upgradeWebSocket((context) => {
      const terminalId = context.req.param("terminalId");
      return {
        onOpen: (_event, socket) =>
          onTerminalSocketOpen(deps, {
            socket,
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
          onDaemonSocketMessage(deps, {
            hostId: websocketContext.hostId,
            raw: event.data,
            sessionId: websocketContext.sessionId,
            socket,
          }),
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
      // Per request, serve from the built UI source when it is active, else the
      // shipped UI. Falls back to shipped if the UI source dist is missing.
      const root = uiSource
        ? uiSource.resolveActiveRoot(shippedRoot)
        : shippedRoot;
      const uiSourceRecoveryEnabled = root !== shippedRoot;
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
          // Inject the recovery shim into every served HTML document so the
          // reload wiring is always present. The UI-source escape hatch is only
          // valid when this response is serving an active fork.
          if (contentType === "text/html") {
            const html = injectRecoveryShim(await readFile(filePath, "utf8"), {
              recoverEnabled: uiSourceRecoveryEnabled,
            });
            return new Response(html, {
              headers: createStaticResponseHeaders({ contentType, urlPath }),
            });
          }
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
      const indexHtml = injectRecoveryShim(
        await readFile(join(root, "index.html"), "utf8"),
        { recoverEnabled: uiSourceRecoveryEnabled },
      );
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
  };
}
