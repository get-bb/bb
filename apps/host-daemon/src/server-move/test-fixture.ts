import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { ServerMoveProgressMessage } from "@bb/host-daemon-contract";
import { writeServerArchive, writeServerMovedFile } from "@bb/server-archive";
import { afterEach, vi } from "vitest";
import type { CommandOf } from "../command-dispatch-support.js";
import type { PendingServerLaunchRequest } from "./pending-server.js";
import { ServerMoveService, type ServerMoveServiceOptions } from "./service.js";
import {
  defaultDetachedProcessSpawner,
  type DetachedSpawnRequest,
} from "./service-manager.js";

const roots: string[] = [];
const httpServers: Server[] = [];
const spawnedPids: number[] = [];

export const MOVE_ID = "move-0001";
export const ACTIVATION_TOKEN = "activation-token-0123456789";
export const HOST_KEY = "host-key-target";
export const PARENT_PID = 424_242;
export const LAUNCHER_ENTRY_PATH = "/opt/npm/bin/bb-app";

export const lastMove = {
  moveId: MOVE_ID,
  fromHostId: "host-source",
  fromHostName: "laptop",
  toHostId: "host-target",
  toHostName: "studio",
  completedAt: 1_700_000_100_000,
  oldCopyDeletedAt: null,
};

const STUB_PENDING_SERVER = `
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
const [dataDir, port] = process.argv.slice(2);
const importFile = JSON.parse(readFileSync(join(dataDir, "server-import.json"), "utf8"));
const server = createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/health") {
    response.end(JSON.stringify({ ok: true, serverMove: { state: "pending", moveId: importFile.moveId } }));
    return;
  }
  if (request.url === "/internal/server-move/pending") {
    response.end(JSON.stringify({ moveId: importFile.moveId, verified: existsSync(join(dataDir, "bb.db")), message: null }));
    return;
  }
  response.statusCode = 404;
  response.end("{}");
});
server.listen(Number(port), "127.0.0.1");
process.on("SIGTERM", () => process.exit(0));
`;

export function registerServerMoveFixtureCleanup(): void {
  afterEach(async () => {
    for (const pid of spawnedPids.splice(0)) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {}
    }
    await Promise.all(
      httpServers
        .splice(0)
        .map(
          (server) =>
            new Promise<void>((resolveClose) =>
              server.close(() => resolveClose()),
            ),
        ),
    );
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });
}

export async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bb-server-move-test-"));
  roots.push(root);
  return root;
}

export async function writeFileWithDirs(
  path: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ url: string; port: number }> {
  const server = createServer(handler);
  httpServers.push(server);
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", () => resolveListen()),
  );
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, port };
}

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", () => resolveListen()),
  );
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

interface SourceServer {
  archiveSha256: string;
  archiveSizeBytes: number;
  archiveKey: Buffer;
  bbAppSha256: string;
  archiveRequests: IncomingMessage[];
  url: string;
}

async function createSourceServer(root: string): Promise<SourceServer> {
  const sourceDir = join(root, "source-data");
  await writeFileWithDirs(join(sourceDir, "bb.db"), "sqlite database bytes");
  await writeFileWithDirs(
    join(sourceDir, "config.json"),
    JSON.stringify({
      config: { BB_LOG_LEVEL: "info" },
      serverUrl: "https://bb.example.test",
      serverHeaders: { "x-bb-connect-machine": "bbcm_source" },
    }),
  );
  await writeFileWithDirs(
    join(sourceDir, "attachments", "project", "a.txt"),
    "attachment",
  );
  await writeFileWithDirs(
    join(sourceDir, "plugins", "tasks", "data.db"),
    "tasks database",
  );
  const archiveKey = randomBytes(32);
  const archivePath = join(root, "server-archive.bbsa");
  const archive = await writeServerArchive({
    outPath: archivePath,
    files: [
      "bb.db",
      "config.json",
      "attachments/project/a.txt",
      "plugins/tasks/data.db",
    ].map((archivePathEntry) => ({
      sourcePath: join(sourceDir, ...archivePathEntry.split("/")),
      archivePath: archivePathEntry,
    })),
    manifest: {
      createdAt: 1_700_000_000_000,
      bbVersion: "1.0.0",
      protocolVersion: 209,
      migrationCount: 10,
      sourceDataDir: "/Users/me/.bb",
      sourceServerHostId: "host-source",
    },
    encryption: { kind: "key", key: archiveKey },
  });
  const bbAppPath = join(root, "bb-app.tgz");
  await writeFile(bbAppPath, "full bb-app package");
  const bbAppBytes = await readFile(bbAppPath);
  const archiveRequests: IncomingMessage[] = [];
  const { url } = await listen((request, response) => {
    if (request.headers.authorization !== `Bearer ${HOST_KEY}`) {
      response.statusCode = 401;
      response.end();
      return;
    }
    if (request.url === `/internal/server-move/${MOVE_ID}/archive`) {
      archiveRequests.push(request);
      response.setHeader("content-length", String(archive.sizeBytes));
      createReadStream(archivePath).pipe(response);
      return;
    }
    if (request.url === `/internal/server-move/${MOVE_ID}/bb-app.tgz`) {
      response.setHeader("content-length", String(bbAppBytes.byteLength));
      response.end(bbAppBytes);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  return {
    archiveSha256: archive.sha256,
    archiveSizeBytes: archive.sizeBytes,
    archiveKey,
    bbAppSha256: createHash("sha256").update(bbAppBytes).digest("hex"),
    archiveRequests,
    url,
  };
}

async function createPackageRoot(root: string): Promise<string> {
  const packageRoot = join(root, "npm", "lib", "node_modules", "bb-app");
  await writeFileWithDirs(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "bb-app", version: "1.0.0" }),
  );
  for (const file of [
    "host-daemon/dist/daemon-bundle.mjs",
    "dist/bb-app.js",
    "dist/bb-server.js",
    "server/dist/index.js",
    "app/dist/index.html",
  ]) {
    await writeFileWithDirs(join(packageRoot, ...file.split("/")), "");
  }
  await writeFileWithDirs(join(root, "npm", "bin", "bb-app"), "");
  return packageRoot;
}

export const launcherProcessOps: ServerMoveServiceOptions["processOps"] = {
  isRunning: (pid) => pid === process.pid,
  readCommand: async (pid) =>
    pid === process.pid ? `node ${LAUNCHER_ENTRY_PATH} start` : null,
};

export async function writeLauncherMovedMode(args: {
  dataDir: string;
  serverPort: number;
  oldCopyEntries?: string[];
}): Promise<void> {
  await writeServerMovedFile(args.dataDir, {
    version: 1,
    moveId: "move-away",
    movedAt: 1_700_000_000_000,
    fromHostId: "host-target",
    toHostId: "host-other",
    toHostName: "other",
    serverUrl: "http://other.example.test:38886",
    mode: "direct",
    connectHandle: null,
    oldCopyEntries: args.oldCopyEntries ?? [],
  });
  await writeBbAppRuntime({
    dataDir: args.dataDir,
    serverPort: args.serverPort,
  });
}

export async function writeBbAppRuntime(args: {
  dataDir: string;
  serverPort: number;
}): Promise<void> {
  await writeFileWithDirs(
    join(args.dataDir, "bb-app-runtime.json"),
    JSON.stringify({
      entryPath: LAUNCHER_ENTRY_PATH,
      pid: process.pid,
      surface: "web",
      serverUrl: `http://127.0.0.1:${args.serverPort}`,
      startedAt: new Date().toISOString(),
      version: "1.0.0",
    }),
  );
}

export async function writeSystemdUnit(args: {
  homeDir: string;
  dataDir: string;
  execStart: string;
}): Promise<string> {
  const unitPath = join(
    args.homeDir,
    ".config",
    "systemd",
    "user",
    "bb-host-daemon-old-server-studio.service",
  );
  await writeFileWithDirs(
    unitPath,
    [
      "[Service]",
      `ExecStart=${args.execStart}`,
      'Environment="BB_APP_NPM_PREFIX=/opt/npm"',
      `Environment="BB_DATA_DIR=${args.dataDir}"`,
      "Restart=always",
      "",
    ].join("\n"),
  );
  return unitPath;
}

export interface FixtureArgs {
  env?: NodeJS.ProcessEnv;
  serverUrl?: string;
  autoUpdate?: boolean;
  hostDaemonPort?: number | null;
  installBbApp?: ServerMoveServiceOptions["installBbApp"];
  checkPortAvailable?: ServerMoveServiceOptions["checkPortAvailable"];
  processOps?: ServerMoveServiceOptions["processOps"];
  portReleaseTimeoutMs?: number;
}

export async function createFixture(args: FixtureArgs = {}) {
  const root = await createRoot();
  const homeDir = join(root, "home");
  const dataDir = join(homeDir, ".bb-machines", "old-server");
  await mkdir(dataDir, { recursive: true });
  const packageRoot = await createPackageRoot(root);
  const stubPath = join(root, "pending-server.mjs");
  await writeFile(stubPath, STUB_PENDING_SERVER);
  const source = await createSourceServer(root);
  const session = { open: false };
  const progress: ServerMoveProgressMessage[] = [];
  const shutdownRequests: Array<[string, 0 | 1]> = [];
  const detachedRequests: DetachedSpawnRequest[] = [];
  const commands: string[][] = [];
  const launches: PendingServerLaunchRequest[] = [];
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const options: ServerMoveServiceOptions = {
    dataDir,
    homeDir,
    hostId: "host-target",
    serverUrl: args.serverUrl ?? source.url,
    hostKey: HOST_KEY,
    serverHeaders: { "x-test-access": "opaque" },
    hostDaemonPort:
      args.hostDaemonPort === undefined ? 38_887 : args.hostDaemonPort,
    autoUpdate: args.autoUpdate ?? false,
    env: args.env ?? { BB_SERVER_MOVE_SERVICE_MANAGER: "none" },
    platform: "linux",
    uid: 1000,
    parentPid: PARENT_PID,
    daemonEntryPath: join(
      packageRoot,
      "host-daemon",
      "dist",
      "daemon-bundle.mjs",
    ),
    logger,
    fetchFn: fetch,
    now: Date.now,
    sleep: (ms) => sleep(ms),
    runCommand: async (command, commandArgs) => {
      commands.push([command, ...commandArgs]);
    },
    spawnDetached: async (request) => {
      detachedRequests.push(request);
      return 999_999;
    },
    launchPendingServer: async (request) => {
      launches.push(request);
      const pid = await defaultDetachedProcessSpawner({
        command: process.execPath,
        args: [stubPath, request.dataDir, String(request.serverPort)],
        env: { PATH: process.env.PATH },
        logPath: request.logPath,
      });
      spawnedPids.push(pid);
      return pid;
    },
    installBbApp: args.installBbApp ?? (async () => undefined),
    checkGhAuthenticated: async () => null,
    checkPortAvailable: args.checkPortAvailable ?? (async () => true),
    processOps: args.processOps ?? launcherProcessOps,
    isServerSessionOpen: () => session.open,
    getShellEnv: () => ({}),
    emitProgress: (message) => {
      progress.push(message);
    },
    requestShutdown: async (reason, exitCode) => {
      shutdownRequests.push([reason, exitCode]);
    },
    pendingServerTimeoutMs: 10_000,
    portReleaseTimeoutMs: args.portReleaseTimeoutMs ?? 400,
    activationSessionCloseTimeoutMs: 10_000,
  };
  const createService = (
    overrides: Partial<ServerMoveServiceOptions> = {},
  ): ServerMoveService => new ServerMoveService({ ...options, ...overrides });
  return {
    root,
    homeDir,
    dataDir,
    packageRoot,
    npmPrefix: join(root, "npm"),
    source,
    session,
    service: createService(),
    createService,
    progress,
    shutdownRequests,
    detachedRequests,
    commands,
    launches,
    logger,
  };
}

export type Fixture = Awaited<ReturnType<typeof createFixture>>;

export async function prepareCommand(
  fixture: Fixture,
  overrides: Partial<CommandOf<"server_move.prepare">> = {},
): Promise<CommandOf<"server_move.prepare">> {
  return {
    type: "server_move.prepare",
    moveId: MOVE_ID,
    activationToken: ACTIVATION_TOKEN,
    archive: {
      downloadPath: `/internal/server-move/${MOVE_ID}/archive`,
      sha256: fixture.source.archiveSha256,
      sizeBytes: fixture.source.archiveSizeBytes,
      key: fixture.source.archiveKey.toString("base64"),
    },
    bbApp: null,
    serverPort: await freePort(),
    bindHost: null,
    sourceDataDir: "/Users/me/.bb",
    sourceServerHostId: "host-source",
    serverUrl: "https://bb.example.test",
    archiveExistingServerData: false,
    ...overrides,
  };
}

export const activateCommand: CommandOf<"server_move.activate"> = {
  type: "server_move.activate",
  moveId: MOVE_ID,
  activationToken: ACTIVATION_TOKEN,
  lastMove,
};
