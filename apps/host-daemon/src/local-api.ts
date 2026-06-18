import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import {
  buildLocalAppOrigins,
  type BuildLocalAppOriginsArgs,
} from "@bb/config/local-app-origins";
import { assignIfDefined } from "@bb/config/objects";
import {
  healthResponseSchema,
  HOST_DAEMON_PROTOCOL_VERSION,
  openInTargetRequestSchema,
  pathsExistRequestSchema,
  providerCliInstallRequestSchema,
  providerCliStatusResponseSchema,
  typedRoutes,
  type HostDaemonLocalSchema,
  type HostPlatform,
  type OpenInTargetRequest,
  type WorkspaceOpenTarget,
} from "@bb/host-daemon-contract";
import { sanitizeInheritedChildProcessEnv } from "@bb/process-utils";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { HostDaemonLocalApiConfig } from "./local-api-config.js";
import {
  listWorkspaceOpenTargets,
  openPathInTarget,
  WorkspaceOpenTargetError,
} from "./workspace-open-targets.js";
import {
  getProviderCliStatus,
  ProviderCliInstallInProgressError,
  streamProviderCliInstall,
} from "./provider-cli-health.js";

const execFileAsync = promisify(execFile);
export type WorkspaceOpenTargetListHandler = () => Promise<
  WorkspaceOpenTarget[]
>;
export type OpenInTargetHandler = (
  request: OpenInTargetRequest,
) => Promise<void>;

export interface StartLocalApiServerOptions {
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
  getProviderCliEnv?: () => Promise<NodeJS.ProcessEnv>;
  getConnected: () => boolean;
  listWorkspaceOpenTargets?: WorkspaceOpenTargetListHandler;
  openInTarget?: OpenInTargetHandler;
  pickFolder?: () => Promise<string | null>;
}

export interface LocalApiServer {
  bindHost: string;
  port: number;
  close(): Promise<void>;
}

export type FolderPickerHandler = () => Promise<string | null>;

export interface ResolveNativeFolderPickerOptions {
  pickFolder?: FolderPickerHandler;
  platform?: NodeJS.Platform;
}

export function resolveNativeFolderPicker(
  options: ResolveNativeFolderPickerOptions,
): FolderPickerHandler | null {
  if (options.pickFolder) {
    return options.pickFolder;
  }

  return (options.platform ?? process.platform) === "darwin"
    ? pickLocalFolder
    : null;
}

export function resolveHostPlatform(
  nodePlatform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): HostPlatform {
  if (nodePlatform === "darwin") return "darwin";
  if (nodePlatform === "linux") {
    const isWsl = env.WSL_DISTRO_NAME != null || env.WSL_INTEROP != null;
    return isWsl ? "wsl" : "linux";
  }
  return "unknown";
}

export async function startLocalApiServer(
  options: StartLocalApiServerOptions,
): Promise<LocalApiServer> {
  const app = new Hono();
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
      origin: (origin, context) => {
        const requestOrigin = new URL(context.req.url).origin;
        if (origin === requestOrigin || allowedCorsOrigins.has(origin)) {
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
  const nativeFolderPicker = resolveNativeFolderPicker({
    pickFolder: options.pickFolder,
  });
  const platform = resolveHostPlatform();

  get("/status", (c) =>
    c.json({
      hostId: options.hostId,
      connected: options.getConnected(),
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
      serverUrl: options.serverUrl,
      supportsNativeFolderPicker: nativeFolderPicker !== null,
      platform,
    }),
  );

  get("/provider-clis/status", async (c) => {
    const env = await options.getProviderCliEnv?.();
    return c.json(
      providerCliStatusResponseSchema.parse(
        await getProviderCliStatus(env ? { env } : {}),
      ),
    );
  });

  app.post("/provider-clis/install", async (c) => {
    const parsed = providerCliInstallRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new HTTPException(400, {
        message: issue?.message ?? "Invalid provider CLI install request",
      });
    }

    try {
      const env = await options.getProviderCliEnv?.();
      return new Response(
        streamProviderCliInstall({
          provider: parsed.data.provider,
          actionKind: parsed.data.actionKind,
          ...(env ? { env } : {}),
        }),
        {
          headers: {
            "content-type": "application/x-ndjson; charset=utf-8",
            "cache-control": "no-store",
          },
        },
      );
    } catch (error) {
      if (error instanceof ProviderCliInstallInProgressError) {
        throw new HTTPException(409, {
          message: error.message,
        });
      }
      throw error;
    }
  });

  post("/paths/exist", pathsExistRequestSchema, async (c, payload) => {
    const entries = await Promise.all(
      payload.paths.map(
        async (path) => [path, await pathExists(path)] as const,
      ),
    );
    return c.json({ existence: Object.fromEntries(entries) });
  });

  get("/workspace-open-targets", async (c) =>
    c.json({
      targets: await (
        options.listWorkspaceOpenTargets ?? listWorkspaceOpenTargets
      )(),
    }),
  );

  post("/open-in-target", openInTargetRequestSchema, async (c, payload) => {
    try {
      await (options.openInTarget ?? openPathInTarget)(payload);
    } catch (error) {
      if (error instanceof WorkspaceOpenTargetError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }

    return c.json({});
  });

  post("/pick-folder", async (c) => {
    if (!nativeFolderPicker) {
      throw new HTTPException(501, {
        message: "Folder picker is only supported on macOS",
      });
    }
    const path = await nativeFolderPicker();
    return c.json({ path });
  });

  const { server, port: boundPort } = await new Promise<{
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return false;
    }
    // Permission denied / loops / etc. — we can't tell, but the entry exists
    // enough to error on, so don't claim it's missing.
    return true;
  }
}

async function pickLocalFolder(): Promise<string | null> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      "osascript",
      [
        "-e",
        'try\nPOSIX path of (choose folder with prompt "Choose a project folder")\non error number -128\nreturn ""\nend try',
      ],
      {
        env: sanitizeInheritedChildProcessEnv({ env: process.env }),
      },
    );
    stdout = result.stdout;
  } catch (error) {
    throw new HTTPException(500, {
      message: `Folder picker failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const selectedPath = stdout.trim();
  if (selectedPath === "") {
    return null;
  }
  return selectedPath.replace(/\/$/, "");
}
