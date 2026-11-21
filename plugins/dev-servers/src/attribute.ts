export interface ProcessEntry {
  pid: number;
  ppid: number;
  name: string;
  threadId: string | null;
  toolCallId: string | null;
  launcher: boolean;
}

export interface ListeningSocket {
  pid: number;
  port: number;
  address: string;
}

export interface ServerPort {
  port: number;
  address: string;
}

export interface AttributedServer {
  threadId: string;
  rootPid: number;
  pids: number[];
  ports: ServerPort[];
}

const SHELL_NAMES = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ash",
  "ksh",
  "mksh",
  "fish",
  "tcsh",
  "csh",
  "nu",
  "elvish",
  "xonsh",
  "pwsh",
]);

const LAUNCHER_NAME =
  /^(?:npm|npx|pnpm|pnpx|yarn|bun|bunx|uv|uvx|pipx|corepack)(?:\s|$)/;
const LAUNCHER_SCRIPT =
  /(?:^|\/)(?:npm|npx|pnpm|yarn|corepack)(?:-cli)?(?:\.c?js)?$/;

export function isLauncher(name: string, argv: readonly string[]): boolean {
  if (LAUNCHER_NAME.test(name)) return true;
  return argv
    .slice(0, 2)
    .some(
      (arg) =>
        LAUNCHER_NAME.test(arg.split("/").at(-1) ?? "") ||
        LAUNCHER_SCRIPT.test(arg),
    );
}

export function inheritHiddenEnvironment(
  table: Map<number, ProcessEntry>,
  hidden: ReadonlySet<number>,
): void {
  const resolved = new Map<
    number,
    Pick<ProcessEntry, "threadId" | "toolCallId">
  >();
  for (const pid of hidden) {
    const path: number[] = [];
    let current = table.get(pid);
    while (
      current !== undefined &&
      hidden.has(current.pid) &&
      !resolved.has(current.pid) &&
      !path.includes(current.pid)
    ) {
      path.push(current.pid);
      current = table.get(current.ppid);
    }
    const inherited =
      current === undefined
        ? { threadId: null, toolCallId: null }
        : (resolved.get(current.pid) ??
          (hidden.has(current.pid)
            ? { threadId: null, toolCallId: null }
            : { threadId: current.threadId, toolCallId: current.toolCallId }));
    for (const member of path) resolved.set(member, inherited);
  }
  for (const [pid, inherited] of resolved) {
    const entry = table.get(pid);
    if (entry !== undefined) table.set(pid, { ...entry, ...inherited });
  }
}

export function isShell(name: string): boolean {
  return SHELL_NAMES.has(name.replace(/^-/, "").replace(/\.exe$/i, ""));
}

function isDescendantOf(
  table: ReadonlyMap<number, ProcessEntry>,
  pid: number,
  ancestorPid: number,
): boolean {
  const seen = new Set<number>();
  let current = table.get(pid);
  while (current !== undefined && !seen.has(current.pid)) {
    if (current.pid === ancestorPid) return true;
    seen.add(current.pid);
    current = table.get(current.ppid);
  }
  return false;
}

function launchedByBridge(
  table: ReadonlyMap<number, ProcessEntry>,
  entry: ProcessEntry,
  daemonPid: number,
): boolean {
  const seen = new Set<number>();
  let parent = table.get(entry.ppid);
  while (
    parent !== undefined &&
    !seen.has(parent.pid) &&
    parent.pid !== daemonPid &&
    (parent.launcher ||
      (isShell(parent.name) &&
        (table.get(parent.ppid)?.launcher === true ||
          table.get(parent.ppid)?.ppid === daemonPid)))
  ) {
    seen.add(parent.pid);
    parent = table.get(parent.ppid);
  }
  if (parent === undefined) return entry.ppid === daemonPid;
  return parent.pid === daemonPid || parent.ppid === daemonPid;
}

export function commandRoot(
  table: ReadonlyMap<number, ProcessEntry>,
  pid: number,
  daemonPid: number,
): ProcessEntry | null {
  const listener = table.get(pid);
  const threadId = listener?.threadId ?? null;
  if (listener === undefined || threadId === null) return null;
  const chain: ProcessEntry[] = [listener];
  const seen = new Set<number>([listener.pid]);
  for (;;) {
    const parent = table.get(chain.at(-1)!.ppid);
    if (parent === undefined || parent.threadId !== threadId) break;
    if (seen.has(parent.pid)) break;
    seen.add(parent.pid);
    chain.push(parent);
  }
  const shellIndex = chain.findIndex(
    (entry, index) =>
      index > 0 &&
      isShell(entry.name) &&
      table.get(entry.ppid)?.launcher !== true,
  );
  const top = chain.at(-1)!;
  const toolCallId = listener.toolCallId;
  const root =
    shellIndex > 0
      ? chain[shellIndex - 1]!
      : toolCallId !== null
        ? [...chain].reverse().find((entry) => entry.toolCallId === toolCallId)!
        : top;
  if (
    launchedByBridge(table, root, daemonPid) ||
    isDescendantOf(table, daemonPid, root.pid)
  )
    return null;
  return root;
}

export function descendants(
  table: ReadonlyMap<number, ProcessEntry>,
  rootPid: number,
): number[] {
  const children = new Map<number, number[]>();
  for (const entry of table.values()) {
    const siblings = children.get(entry.ppid) ?? [];
    siblings.push(entry.pid);
    children.set(entry.ppid, siblings);
  }
  const result: number[] = [];
  const queue = [rootPid];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    result.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return result;
}

export function attributeServers(args: {
  table: ReadonlyMap<number, ProcessEntry>;
  sockets: readonly ListeningSocket[];
  daemonPid: number;
  threadId: string | null;
}): AttributedServer[] {
  const servers = new Map<number, AttributedServer>();
  for (const socket of args.sockets) {
    const root = commandRoot(args.table, socket.pid, args.daemonPid);
    if (root === null || root.threadId === null) continue;
    if (args.threadId !== null && root.threadId !== args.threadId) continue;
    const server = servers.get(root.pid) ?? {
      threadId: root.threadId,
      rootPid: root.pid,
      pids: [],
      ports: [],
    };
    if (!server.pids.includes(socket.pid)) server.pids.push(socket.pid);
    if (
      !server.ports.some(
        (port) => port.port === socket.port && port.address === socket.address,
      )
    )
      server.ports.push({ port: socket.port, address: socket.address });
    servers.set(root.pid, server);
  }
  return [...servers.values()]
    .map((server) => ({
      ...server,
      pids: server.pids.sort((left, right) => left - right),
      ports: server.ports.sort(
        (left, right) =>
          left.port - right.port || left.address.localeCompare(right.address),
      ),
    }))
    .sort((left, right) => left.ports[0]!.port - right.ports[0]!.port);
}
