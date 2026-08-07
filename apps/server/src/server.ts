import { createNodeWebSocket } from "@hono/node-ws";
import { readFile, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
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
import { registerInternalSessionRoutes } from "./internal/session.js";
import { registerInternalSkillRoutes } from "./internal/skills.js";
import { registerInternalToolCallRoutes } from "./internal/tool-calls.js";
import {
  setAuthenticatedDaemon,
  verifyAuthenticatedDaemon,
} from "./internal/auth.js";
import {
  createInternalExecutionSessions,
  type InternalExecutionPrincipalMode,
} from "./auth/internal-execution-sessions.js";
import { createInternalPrincipalAuthority } from "./auth/internal-principal-authority.js";
import { createLocalOwnerPrincipalPolicy } from "./auth/local-owner-adapter.js";
import { registerReadinessRoute } from "./readiness.js";
import type { PrincipalPolicy } from "./auth/principal-policy.js";
import { createPublicHttpAuthorizationMiddleware } from "./auth/public-http-authorization.js";
import {
  captureTrustedRemoteAddress,
  createInternalPrincipalExecutionScopeMiddleware,
  createResolvePrincipalMiddleware,
  readPrincipalRequestTarget,
  requireClientSocketSession,
  resolveRequestAppSurface,
} from "./request-context.js";
import { runWithTelemetryAppSurface } from "./services/system/telemetry.js";
import {
  createClientSocketProtocol,
  type ClientSocketClock,
} from "./ws/client-protocol.js";
import {
  onDaemonSocketClose,
  onDaemonSocketMessage,
  onDaemonSocketOpen,
  validateDaemonWebSocket,
} from "./ws/daemon-protocol.js";
import { roundDurationMs } from "./services/lib/duration.js";
import {
  createTerminalSocketProtocol,
  type TerminalSocketClock,
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
import { callHostRetryableOnlineRpc } from "./services/hosts/online-rpc.js";
import { browserRequestProblem } from "./browser-request-guard.js";
import { registerRoomDistributionHttpRoutes } from "./room-distribution/room-distribution-http.js";
import type { WorkTogetherRoomDistributionV1 } from "./room-distribution/room-distribution-port.js";
import { parseRoomDistributionTarget } from "./room-distribution/room-distribution-target.js";
import {
  createRoomDistributionSocketProtocol,
  type RoomDistributionSocketClock,
} from "./room-distribution/room-distribution-websocket.js";
import type { WorkTogetherRoomResourceProvisioner } from "./room-distribution/room-resource-provisioner.js";
import { registerRoomProvisioningHttpRoute } from "./room-distribution/room-provisioning-http.js";

export type CloseWebSockets = () => Promise<void>;
type NodeWebSocketServer = ReturnType<typeof createNodeWebSocket>["wss"];
type WebSocketCloseError = Error | undefined;

export interface ServerApp {
  app: Hono;
  closeWebSockets: CloseWebSockets;
  injectWebSocket: ReturnType<typeof createNodeWebSocket>["injectWebSocket"];
  pluginService: PluginService;
  pluginCatalogService: PluginCatalogService;
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
  principalPolicy?: PrincipalPolicy;
  /**
   * Exact mode for server-minted plugin background / thread-agent sessions.
   * Defaults to local-owner; start-server forwards principalRuntime.principalMode.
   */
  principalMode?: InternalExecutionPrincipalMode;
  /** Work Together-only closed Room distribution; never mounted in stock mode. */
  roomDistribution?: WorkTogetherRoomDistributionV1;
  /** WT-only owner-authorized provisioning control plane; never public-proxied. */
  roomResourceProvisioner?: WorkTogetherRoomResourceProvisioner;
  /**
   * Loopback readiness wiring for `GET /readyz`. start-server forwards the
   * membership-port reachability probe in work-together mode; its presence is
   * also the "policy adapter composed" signal. Never carries membership data.
   */
  readiness?: {
    readonly probeMembershipReachable?: () => Promise<boolean>;
  };
  slowApiRequestLogThresholdMs?: number;
  staticDir?: string;
  /**
   * Private test seam for deterministic client-socket and terminal-socket
   * timers and recheck cadence. Production omits this (10s recheck, wall
   * clock). Invalid or >15_000ms intervals are rejected by the protocol
   * factories. Client and terminal sockets share this runtime so recheck /
   * authorize budgets stay aligned with the S2.1 ≤14s production objective.
   */
  clientSocketRuntime?: {
    readonly clock?: Partial<
      ClientSocketClock & TerminalSocketClock & RoomDistributionSocketClock
    >;
    readonly membershipRecheckIntervalMs?: number;
  };
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
const INSTALL_MACHINE_SCRIPT_PATH = fileURLToPath(
  new URL("./assets/install-machine.sh", import.meta.url),
);
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
  const fallbackPrincipalPolicy =
    options?.principalPolicy ?? createLocalOwnerPrincipalPolicy();
  const principalMode = options?.principalMode ?? "local-owner";
  if (options?.roomDistribution && principalMode !== "work-together") {
    throw new Error("Room distribution requires work-together principal mode");
  }
  if (options?.roomResourceProvisioner && principalMode !== "work-together") {
    throw new Error("Room provisioning requires work-together principal mode");
  }
  const internalPrincipalAuthority = createInternalPrincipalAuthority({
    fallbackPolicy: fallbackPrincipalPolicy,
  });
  const internalExecutionSessions = createInternalExecutionSessions({
    mode: principalMode,
  });
  const principalPolicy = internalPrincipalAuthority.principalPolicy;
  const resolveHttpPrincipal = createResolvePrincipalMiddleware(
    principalPolicy,
    "http",
  );
  const resolveWebSocketPrincipal = createResolvePrincipalMiddleware(
    principalPolicy,
    "websocket",
  );
  const runInternalPrincipalExecutionScope =
    createInternalPrincipalExecutionScopeMiddleware(internalPrincipalAuthority);
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
  registerReadinessRoute(app, {
    db: deps.db,
    principalMode,
    ...(options?.readiness?.probeMembershipReachable !== undefined
      ? { probeMembershipReachable: options.readiness.probeMembershipReachable }
      : {}),
  });
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
  app.use("/api/v1/*", resolveHttpPrincipal);
  app.use("/api/v1/*", runInternalPrincipalExecutionScope);
  app.use(
    "/api/v1/*",
    createPublicHttpAuthorizationMiddleware({ db: deps.db }),
  );
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
    pendingInteractions: deps.pendingInteractions,
    dataDir: deps.config.dataDir,
    appVersion: deps.config.appVersion,
    sharedPorts: deps.sharedPorts,
    ensureSharedPortTunnel: (hostId) =>
      deps.sharedPorts.ensureTunnelIdentity(hostId, () =>
        callHostRetryableOnlineRpc(deps, {
          command: { type: "connect-tunnel.ensure-identity" },
          hostId,
          timeoutMs: 30_000,
        }),
      ),
    watchBuiltinPluginSources:
      process.env.BB_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD === "1",
    internalExecution: {
      authority: internalPrincipalAuthority,
      sessions: internalExecutionSessions,
    },
  });
  // Bridge the thread lifecycle seams to this service's plugins (§4.5).
  setPluginThreadEventEmitter(pluginService.events);
  // Bridge runtime-config assembly to plugin skills + context (§4.4).
  setPluginAgentContributions(pluginService);
  const publicApi = new Hono();
  const pluginCatalogService = createPluginCatalogService({
    db: deps.db,
    appVersion: deps.config.appVersion,
    plugins: pluginService,
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

  if (options?.roomDistribution) {
    app.use("/api/bb-rooms/v1/*", (context, next) =>
      context.req.path.endsWith("/subscribe")
        ? next()
        : resolveHttpPrincipal(context, next),
    );
    app.use("/api/bb-rooms/v1/*", (context, next) =>
      context.req.path.endsWith("/subscribe")
        ? next()
        : runInternalPrincipalExecutionScope(context, next),
    );
    registerRoomDistributionHttpRoutes(app, options.roomDistribution);
  }
  if (options?.roomResourceProvisioner) {
    app.use("/api/bb-room-provisioning/v1/*", resolveHttpPrincipal);
    app.use(
      "/api/bb-room-provisioning/v1/*",
      runInternalPrincipalExecutionScope,
    );
    registerRoomProvisioningHttpRoute(app, options.roomResourceProvisioner);
  }
  const internalApi = new Hono();
  registerInternalHostRoutes(internalApi, deps);
  registerInternalSessionRoutes(internalApi, deps);
  registerInternalSkillRoutes(internalApi, deps);
  registerInternalEventRoutes(internalApi, deps);
  registerInternalToolCallRoutes(internalApi, deps);
  registerInternalInteractiveRequestRoutes(internalApi, deps);
  app.route("/internal", internalApi);

  // One manager per createApp: binds the upgrade-time principal session,
  // serializes client messages, and runs security deadlines independently.
  // Never re-resolves identity from messages.
  const clientSocketProtocol = createClientSocketProtocol({
    hub: deps.hub,
    watchInterests: deps.watchInterests,
    db: deps.db,
    clock: options?.clientSocketRuntime?.clock,
    membershipRecheckIntervalMs:
      options?.clientSocketRuntime?.membershipRecheckIntervalMs,
  });

  // Terminal human WebSockets: same immutable session capture and security
  // timer budget as /ws. Scoped open authorizes before attach; unrestricted
  // preserves stock attach/error without timers.
  const terminalSocketProtocol = createTerminalSocketProtocol({
    deps: {
      terminalSessions: deps.terminalSessions,
      db: deps.db,
    },
    clock: options?.clientSocketRuntime?.clock,
    membershipRecheckIntervalMs:
      options?.clientSocketRuntime?.membershipRecheckIntervalMs,
  });
  const roomDistributionSocketProtocol = options?.roomDistribution
    ? createRoomDistributionSocketProtocol({
        distribution: options.roomDistribution,
        clock: options.clientSocketRuntime?.clock,
        membershipRecheckIntervalMs:
          options.clientSocketRuntime?.membershipRecheckIntervalMs,
      })
    : null;

  if (roomDistributionSocketProtocol !== null) {
    app.use(
      "/api/bb-rooms/v1/rooms/:bindingId/subscribe",
      resolveWebSocketPrincipal,
    );
    app.get(
      "/api/bb-rooms/v1/rooms/:bindingId/subscribe",
      upgradeWebSocket((context) => {
        let target;
        try {
          target = parseRoomDistributionTarget({
            method: context.req.method,
            target: readPrincipalRequestTarget(context),
            transport: "websocket",
          });
        } catch {
          throw new ApiError(404, "not_found", "Not found");
        }
        if (target.operation !== "subscribe") {
          throw new ApiError(404, "not_found", "Not found");
        }
        const session = requireClientSocketSession(context);
        return {
          onOpen: (_event, socket) =>
            roomDistributionSocketProtocol.open(
              socket,
              session,
              target.bindingId,
              target.cursor,
              target.childAttachmentId,
            ),
          onMessage: (_event, socket) =>
            roomDistributionSocketProtocol.message(socket),
          onClose: (_event, socket) =>
            roomDistributionSocketProtocol.close(socket),
        };
      }),
    );
  }
  app.use("/api/bb-rooms/v1/*", () => {
    throw new ApiError(404, "not_found", "Not found");
  });

  app.use("/ws", resolveWebSocketPrincipal);
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
      // Capture frozen client-socket session after origin check, before open.
      // Avoids a window that would register a scoped socket unrestricted.
      const clientSocketSession = requireClientSocketSession(context);
      return {
        onOpen: (_event, socket) =>
          clientSocketProtocol.open(socket, clientSocketSession),
        onMessage: (event, socket) =>
          clientSocketProtocol.message(socket, event.data),
        onClose: (_event, socket) => clientSocketProtocol.close(socket),
      };
    }),
  );

  app.use("/ws/terminals/*", resolveWebSocketPrincipal);
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
      // Capture the same immutable ClientSocketSession after Origin validation.
      // Bind path terminalId forever — no in-band retarget.
      const clientSocketSession = requireClientSocketSession(context);
      const terminalId = context.req.param("terminalId");
      return {
        onOpen: (_event, socket) =>
          terminalSocketProtocol.open(socket, clientSocketSession, terminalId),
        onMessage: (event, socket) =>
          terminalSocketProtocol.message(socket, event.data),
        onClose: (_event, socket) => terminalSocketProtocol.close(socket),
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
  };
}
