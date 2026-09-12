import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createBenchApi, waitUntil, type BenchApi } from "./api.js";
import {
  processTreeCpuMs,
  reservePort,
  sanitizedParentEnv,
  spawnLogged,
  stopProcessGroup,
} from "./processes.js";

export interface BackendPaths {
  daemonDataDir: string;
  logsDir: string;
  serverDataDir: string;
}

export interface StartBackendArgs {
  daemonEnv?: Record<string, string>;
  logLevel: string;
  paths: BackendPaths;
  repoRoot: string;
  serverEnv?: Record<string, string>;
  serverNodeArgs?: string[];
}

export interface Backend {
  api: BenchApi;
  serverStdioLogPath: string;
  cpuMs(): { daemon: number; server: number };
  daemonPid: number;
  hostId: string;
  serverPid: number;
  serverUrl: string;
  stop(): Promise<void>;
}

const DAEMON_HOST_ID_FILE = "host-id";

function writeShellWrapper(dir: string): string {
  const wrapperPath = join(dir, "bench-shell.sh");
  writeFileSync(
    wrapperPath,
    '#!/bin/bash\nlast="${@: -1}"\nexec /bin/bash -c "$last"\n',
    { mode: 0o755 },
  );
  return wrapperPath;
}

export async function startBackend(args: StartBackendArgs): Promise<Backend> {
  const { paths, repoRoot } = args;
  for (const dir of [paths.serverDataDir, paths.daemonDataDir, paths.logsDir]) {
    mkdirSync(dir, { recursive: true });
  }
  const serverEntry = join(repoRoot, "apps/server/dist/index.js");
  const daemonEntry = join(repoRoot, "apps/host-daemon/dist/index.js");
  for (const entry of [
    serverEntry,
    daemonEntry,
    join(repoRoot, "apps/app/dist/index.html"),
    join(repoRoot, "apps/cli/dist/index.js"),
  ]) {
    if (!existsSync(entry)) {
      throw new Error(
        `Missing build artifact ${entry}. Run: pnpm exec turbo run build --filter=@bb/app --filter=@bb/server --filter=@bb/host-daemon --filter=@bb/bundled-plugins --filter=@get-bb/plugin-sdk --filter=@bb/cli`,
      );
    }
  }
  const serverPort = await reservePort();
  const daemonPort = await reservePort();
  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const baseEnv = sanitizedParentEnv();
  const server = spawnLogged({
    args: [...(args.serverNodeArgs ?? []), serverEntry],
    command: process.execPath,
    cwd: repoRoot,
    env: {
      ...baseEnv,
      ...args.serverEnv,
      BB_DATA_DIR: paths.serverDataDir,
      BB_LOG_LEVEL: args.logLevel,
      BB_SERVER_PORT: String(serverPort),
      BB_TELEMETRY: "false",
      NODE_ENV: "production",
    },
    logPath: join(paths.logsDir, "server-stdio.log"),
  });
  const serverPid = server.pid;
  if (serverPid === undefined) {
    throw new Error("Server failed to spawn");
  }
  const api = createBenchApi(serverUrl);
  let daemonPid: number | undefined;
  const stop = async () => {
    await stopProcessGroup(daemonPid);
    await stopProcessGroup(serverPid);
  };
  try {
    await waitUntil(
      async () => ((await api.isReady()) ? true : null),
      "bench server readiness",
      120_000,
    );
    const daemonEnv: NodeJS.ProcessEnv = {
      ...baseEnv,
      ...args.daemonEnv,
      BB_DATA_DIR: paths.daemonDataDir,
      BB_HOST_DAEMON_PORT: String(daemonPort),
      BB_LOG_LEVEL: args.logLevel,
      BB_SERVER_URL: serverUrl,
      BB_TELEMETRY: "false",
      NODE_ENV: "production",
      SHELL: writeShellWrapper(paths.daemonDataDir),
    };
    if (!existsSync(join(paths.daemonDataDir, DAEMON_HOST_ID_FILE))) {
      const enroll = await api.createEnrollKey();
      daemonEnv.BB_HOST_ENROLL_KEY = enroll.enrollKey;
      daemonEnv.BB_HOST_ID = enroll.hostId;
    }
    const daemon = spawnLogged({
      args: [daemonEntry],
      command: process.execPath,
      cwd: repoRoot,
      env: daemonEnv,
      logPath: join(paths.logsDir, "daemon-stdio.log"),
    });
    daemonPid = daemon.pid;
    const resolvedDaemonPid = daemonPid;
    if (resolvedDaemonPid === undefined) {
      throw new Error("Host daemon failed to spawn");
    }
    const hostId = await waitUntil(
      async () => (await api.listConnectedHostIds())[0] ?? null,
      "bench host daemon connection",
      120_000,
    );
    return {
      api,
      cpuMs: () => ({
        daemon: processTreeCpuMs(resolvedDaemonPid),
        server: processTreeCpuMs(serverPid),
      }),
      daemonPid: resolvedDaemonPid,
      hostId,
      serverPid,
      serverStdioLogPath: join(paths.logsDir, "server-stdio.log"),
      serverUrl,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
