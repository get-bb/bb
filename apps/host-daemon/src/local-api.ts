import fs from "node:fs/promises";
import { serve } from "@hono/node-server";
import {
  buildLocalAppOrigins,
  type BuildLocalAppOriginsArgs,
} from "@bb/config/local-app-origins";
import {
  formatClientConfigPath,
  normalizeClientServerOrigin,
  parseClientConfig,
  resolveClientSshAuthority,
  type ClientConfig,
} from "@bb/config/client-config";
import { assignIfDefined } from "@bb/config/objects";
import {
  healthResponseSchema,
  HOST_DAEMON_PROTOCOL_VERSION,
  openInTargetRequestSchema,
  typedRoutes,
  workspaceOpenTargetsQuerySchema,
  type HostDaemonLocalSchema,
  type OpenInTargetRequest,
  type WorkspaceOpenTarget,
  type WorkspaceOpenTargetsQuery,
} from "@bb/host-daemon-contract";
import {
  listWorkspaceOpenTargets,
  openPathInTarget,
  type OpenPathInTargetArgs,
  WorkspaceOpenTargetError,
} from "@bb/local-open-targets";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { isFsErrorWithCode } from "./fs-errors.js";
import type { HostDaemonLocalApiConfig } from "./local-api-config.js";
import { resolveHostPlatform } from "./host-platform.js";

export type WorkspaceOpenTargetListHandler = (
  query: WorkspaceOpenTargetsQuery,
) => Promise<WorkspaceOpenTarget[]>;
export type OpenInTargetHandler = (
  request: OpenPathInTargetArgs,
) => Promise<void>;

/**
 * Browser-reachable local HTTP API for colocated setups.
 *
 * Route ownership is documented in `@bb/host-daemon-contract/src/local.ts`.
 * Some routes describe the UI/client machine, while others describe the
 * work-host machine. Remote-client support should route work-host operations
 * through the server and connected work host daemon instead of adding them to a
 * client.
 */
export interface StartLocalApiServerOptions {
  dataDir?: string;
  hostId: string;
  localApiConfig: HostDaemonLocalApiConfig;
  serverUrl: string;
  /** Port the BB server binds on (parsed from `serverUrl` upstream so the
   * daemon doesn't need to depend on server config). Used to build the CORS
   * allowlist. */
  serverPort: number;
  /** Vite dev port for the BB app frontend; allowed origin for CORS when set. */
  devAppPort?: number;
  /** Optional public app origin (e.g. `https://app.example.com`); allowed
   * origin for CORS when the frontend is served from a non-localhost domain. */
  appUrl?: string;
  getConnected: () => boolean;
  listWorkspaceOpenTargets?: WorkspaceOpenTargetListHandler;
  openInTarget?: OpenInTargetHandler;
}

export interface LocalApiServer {
  bindHost: string;
  port: number;
  close(): Promise<void>;
}

interface ClientConfigLoader {
  load(): Promise<ClientConfig>;
}

interface ResolveOpenPathInTargetArgs {
  configLoader: ClientConfigLoader;
  request: OpenInTargetRequest;
}

const CLIENT_CONFIG_CACHE_TTL_MS = 1_000;
const EMPTY_CLIENT_CONFIG: ClientConfig = { servers: {} };

function isNoEntryError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function createClientConfigLoader(
  dataDir: string | undefined,
  nowMs: () => number = Date.now,
): ClientConfigLoader {
  let cache: {
    expiresAtMs: number;
    promise: Promise<ClientConfig>;
  } | null = null;

  return {
    async load(): Promise<ClientConfig> {
      if (dataDir === undefined) {
        return EMPTY_CLIENT_CONFIG;
      }
      const now = nowMs();
      if (cache !== null && cache.expiresAtMs > now) {
        return cache.promise;
      }
      cache = {
        expiresAtMs: now + CLIENT_CONFIG_CACHE_TTL_MS,
        promise: readClientConfig(dataDir),
      };
      return cache.promise;
    },
  };
}

async function readClientConfig(dataDir: string): Promise<ClientConfig> {
  try {
    return parseClientConfig(
      JSON.parse(await fs.readFile(formatClientConfigPath(dataDir), "utf8")),
    );
  } catch (error) {
    if (!isNoEntryError(error)) {
      throw error;
    }
    return EMPTY_CLIENT_CONFIG;
  }
}

async function isConfiguredClientOrigin(
  origin: string,
  configLoader: ClientConfigLoader,
): Promise<boolean> {
  try {
    const serverOrigin = normalizeClientServerOrigin(origin);
    const config = await configLoader.load();
    return config.servers[serverOrigin] !== undefined;
  } catch {
    return false;
  }
}

async function resolveOpenPathInTargetArgs({
  configLoader,
  request,
}: ResolveOpenPathInTargetArgs): Promise<OpenPathInTargetArgs> {
  if (request.context.kind === "local") {
    return {
      columnNumber: request.columnNumber,
      context: { kind: "local" },
      lineNumber: request.lineNumber,
      path: request.path,
      targetId: request.targetId,
    };
  }

  const serverOrigin = normalizeClientServerOrigin(
    request.context.serverOrigin,
  );
  const config = await configLoader.load();
  const sshAuthority = resolveClientSshAuthority(config, {
    serverOrigin,
    hostId: request.context.hostId,
  });
  if (sshAuthority === null) {
    throw new WorkspaceOpenTargetError({
      code: "remote_mapping_missing",
      message: `No SSH target configured for host ${request.context.hostId} on ${serverOrigin}. Run: bb-app client ssh-target set ${serverOrigin} <ssh-target>`,
    });
  }

  return {
    columnNumber: request.columnNumber,
    context: {
      kind: "remote-ssh",
      serverOrigin,
      hostId: request.context.hostId,
      sshAuthority,
    },
    lineNumber: request.lineNumber,
    path: request.path,
    targetId: request.targetId,
  };
}

export async function startLocalApiServer(
  options: StartLocalApiServerOptions,
): Promise<LocalApiServer> {
  const app = new Hono();
  const clientConfigLoader = createClientConfigLoader(options.dataDir);
  const originArgs: BuildLocalAppOriginsArgs = {
    serverPort: options.serverPort,
  };
  assignIfDefined({
    key: "appUrl",
    target: originArgs,
    value: options.appUrl,
  });
  assignIfDefined({
    key: "devAppPort",
    target: originArgs,
    value: options.devAppPort,
  });
  const allowedCorsOrigins = new Set<string>(buildLocalAppOrigins(originArgs));
  app.use(
    "*",
    cors({
      origin: async (origin, context) => {
        const requestOrigin = new URL(context.req.url).origin;
        if (
          origin === requestOrigin ||
          allowedCorsOrigins.has(origin) ||
          (await isConfiguredClientOrigin(origin, clientConfigLoader))
        ) {
          return origin;
        }
        return null;
      },
    }),
  );

  app.get(options.localApiConfig.healthPath, (c) =>
    c.text(healthResponseSchema.parse(options.localApiConfig.healthValue)),
  );
  app.use("*", async (c, next) => {
    if (options.localApiConfig.mode === "health-only") {
      return c.notFound();
    }
    await next();
  });

  const { get, post } = typedRoutes<HostDaemonLocalSchema>(app);
  const platform = resolveHostPlatform();

  get("/status", (c) =>
    c.json({
      hostId: options.hostId,
      connected: options.getConnected(),
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
      serverUrl: options.serverUrl,
      supportsNativeFolderPicker: platform === "darwin",
      platform,
    }),
  );

  get(
    "/workspace-open-targets",
    workspaceOpenTargetsQuerySchema,
    async (c, query) =>
      c.json({
        targets: await (
          options.listWorkspaceOpenTargets ?? listWorkspaceOpenTargets
        )(query),
      }),
  );

  post("/open-in-target", openInTargetRequestSchema, async (c, payload) => {
    try {
      await (options.openInTarget ?? openPathInTarget)(
        await resolveOpenPathInTargetArgs({
          configLoader: clientConfigLoader,
          request: payload,
        }),
      );
    } catch (error) {
      if (error instanceof WorkspaceOpenTargetError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }

    return c.json({});
  });

  let boundServer: {
    server: ReturnType<typeof serve>;
    port: number;
  };
  try {
    boundServer = await new Promise<{
      server: ReturnType<typeof serve>;
      port: number;
    }>((resolve, reject) => {
      const s = serve(
        {
          fetch: app.fetch,
          port: options.localApiConfig.port,
          hostname: options.localApiConfig.bindHost,
        },
        (info) => resolve({ server: s, port: info.port }),
      );
      s.on("error", reject);
    });
  } catch (error) {
    if (isFsErrorWithCode(error, "EADDRINUSE")) {
      throw new Error(
        `Host daemon local API port ${options.localApiConfig.port} is already in use on ${options.localApiConfig.bindHost}. Choose another port with --host-daemon-port <port>.`,
        { cause: error },
      );
    }
    throw error;
  }

  const { server, port: boundPort } = boundServer;

  return {
    bindHost: options.localApiConfig.bindHost,
    port: boundPort,
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
