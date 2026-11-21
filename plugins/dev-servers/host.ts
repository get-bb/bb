import { experimental_execHostFile as execHostFile } from "@get-bb/plugin-sdk/process";
import {
  experimental_defineHostEntry,
  experimental_readProcessIdentity as readProcessIdentity,
} from "@get-bb/plugin-sdk/host";
import { devServersHostContract, type DevServer } from "./contract.js";
import { attributeServers, descendants } from "./src/attribute.js";
import {
  readDarwinCwd,
  readDarwinSnapshot,
  type RunTool,
} from "./src/darwin.js";
import {
  readLinuxCwd,
  readLinuxSnapshot,
  type ProcessSnapshot,
} from "./src/linux.js";

const STOP_GRACE_MS = 3_000;
const START_TOLERANCE_MS = 2_000;
const STOP_POLL_MS = 100;

export interface DevServersHostDependencies {
  readonly selfPid: number;
  readonly daemonPid: number;
  readSnapshot(): Promise<ProcessSnapshot | null>;
  readCwd(pid: number): Promise<string | null>;
  readIdentity(
    pid: number,
  ): Promise<{ command: string | null; startedAt: number | null } | null>;
  kill(pid: number, signal: NodeJS.Signals | 0): void;
  sleep(ms: number): Promise<void>;
}

const runTool: RunTool = async (command, args) => {
  try {
    return (await execHostFile(command, args, { maxBuffer: 64 * 1024 * 1024 }))
      .stdout;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === 1 &&
      "stdout" in error &&
      typeof error.stdout === "string"
    )
      return error.stdout;
    return null;
  }
};

function defaultDependencies(): DevServersHostDependencies | null {
  const uid = process.getuid?.();
  if (uid === undefined) return null;
  const common = {
    selfPid: process.pid,
    daemonPid: process.ppid,
    readIdentity: readProcessIdentity,
    kill: (pid: number, signal: NodeJS.Signals | 0) => {
      process.kill(pid, signal);
    },
    sleep: (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
  if (process.platform === "linux")
    return {
      ...common,
      readSnapshot: () => readLinuxSnapshot(uid),
      readCwd: (pid) => readLinuxCwd(pid),
    };
  if (process.platform === "darwin")
    return {
      ...common,
      readSnapshot: () => readDarwinSnapshot(uid, runTool),
      readCwd: (pid) => readDarwinCwd(pid, runTool),
    };
  return null;
}

function sameStart(current: number | null, listed: number | null): boolean {
  if (current === null || listed === null) return current === listed;
  return Math.abs(current - listed) <= START_TOLERANCE_MS;
}

function alive(deps: DevServersHostDependencies, pid: number): boolean {
  try {
    deps.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function ancestorsOf(snapshot: ProcessSnapshot, pid: number): Set<number> {
  const ancestors = new Set<number>();
  let current = snapshot.table.get(pid);
  while (current !== undefined && !ancestors.has(current.pid)) {
    ancestors.add(current.pid);
    current = snapshot.table.get(current.ppid);
  }
  ancestors.add(pid);
  return ancestors;
}

export async function listDevServers(
  deps: DevServersHostDependencies,
  threadId: string | null,
): Promise<DevServer[]> {
  const snapshot = await deps.readSnapshot();
  if (snapshot === null) return [];
  const attributed = attributeServers({
    table: snapshot.table,
    sockets: snapshot.sockets,
    daemonPid: deps.daemonPid,
    threadId,
  });
  return Promise.all(
    attributed.map(async (server) => {
      const listenerPid = server.pids[0]!;
      const [identity, listener, cwd] = await Promise.all([
        deps.readIdentity(server.rootPid),
        listenerPid === server.rootPid ? null : deps.readIdentity(listenerPid),
        deps.readCwd(server.rootPid),
      ]);
      return {
        threadId: server.threadId,
        rootPid: server.rootPid,
        startedAt: identity?.startedAt ?? null,
        command: (listener ?? identity)?.command ?? null,
        cwd,
        ports: server.ports,
      };
    }),
  );
}

export async function stopDevServer(
  deps: DevServersHostDependencies,
  input: { threadId: string; rootPid: number; startedAt: number | null },
): Promise<{ stopped: boolean }> {
  const snapshot = await deps.readSnapshot();
  if (snapshot === null) return { stopped: false };
  const server = attributeServers({
    table: snapshot.table,
    sockets: snapshot.sockets,
    daemonPid: deps.daemonPid,
    threadId: input.threadId,
  }).find((candidate) => candidate.rootPid === input.rootPid);
  if (server === undefined) return { stopped: false };
  const identity = await deps.readIdentity(input.rootPid);
  if (identity === null || !sameStart(identity.startedAt, input.startedAt))
    return { stopped: false };
  const protectedPids = ancestorsOf(snapshot, deps.selfPid);
  protectedPids.add(deps.daemonPid);
  const targets = descendants(snapshot.table, input.rootPid).filter(
    (pid) => !protectedPids.has(pid),
  );
  const startTimes = new Map(
    await Promise.all(
      targets.map(
        async (pid) =>
          [pid, (await deps.readIdentity(pid))?.startedAt ?? null] as const,
      ),
    ),
  );
  for (const pid of targets) {
    try {
      deps.kill(pid, "SIGTERM");
    } catch {
      continue;
    }
  }
  for (let waited = 0; waited < STOP_GRACE_MS; waited += STOP_POLL_MS) {
    if (!targets.some((pid) => alive(deps, pid))) return { stopped: true };
    await deps.sleep(STOP_POLL_MS);
  }
  for (const pid of targets) {
    if (!alive(deps, pid)) continue;
    const identity = await deps.readIdentity(pid);
    if (
      identity === null ||
      !sameStart(identity.startedAt, startTimes.get(pid) ?? null)
    )
      continue;
    try {
      deps.kill(pid, "SIGKILL");
    } catch {
      continue;
    }
  }
  return { stopped: true };
}

export function createDevServersHostEntry(
  deps: DevServersHostDependencies | null,
) {
  return experimental_defineHostEntry({
    contract: devServersHostContract,
    handlers: {
      list: async ({ threadId }) =>
        deps === null
          ? { supported: false, servers: [] }
          : { supported: true, servers: await listDevServers(deps, threadId) },
      stop: (input) =>
        deps === null ? { stopped: false } : stopDevServer(deps, input),
    },
  });
}

export default createDevServersHostEntry(defaultDependencies());
