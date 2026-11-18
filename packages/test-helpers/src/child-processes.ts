import { ChildProcess, execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { channel } from "node:diagnostics_channel";
import { mkdtemp, open, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const POSIX_SOCKET_PATH_LIMIT = 100;

export function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

export function waitForExit(child: ChildProcess): Promise<void> {
  if (hasExited(child)) return Promise.resolve();
  return new Promise((resolveExit, rejectExit) => {
    const onExit = () => {
      child.off("error", onError);
      resolveExit();
    };
    const onError = (error: Error) => {
      if (child.pid !== undefined) return;
      child.off("exit", onExit);
      rejectExit(error);
    };
    child.once("exit", onExit);
    child.on("error", onError);
  });
}

export interface ChildProcessTracker {
  readonly children: readonly ChildProcess[];
  running(): ChildProcess[];
  waitForExit(): Promise<void>;
  waitForClose(): Promise<void>;
  killRunning(signal?: NodeJS.Signals): void;
  dispose(): void;
  [Symbol.dispose](): void;
}

export function trackChildProcesses(): ChildProcessTracker {
  const children: ChildProcess[] = [];
  const closures: Promise<void>[] = [];
  const childProcessChannel = channel("child_process");
  const onChildProcess = (message: unknown): void => {
    if (
      typeof message === "object" &&
      message !== null &&
      "process" in message &&
      message.process instanceof ChildProcess
    ) {
      const child = message.process;
      children.push(child);
      closures.push(
        new Promise((resolveClose) =>
          child.once("close", () => resolveClose()),
        ),
      );
    }
  };
  childProcessChannel.subscribe(onChildProcess);
  const dispose = () => {
    childProcessChannel.unsubscribe(onChildProcess);
  };
  return {
    children,
    running: () =>
      children.filter((child) => child.pid !== undefined && !hasExited(child)),
    async waitForExit() {
      let pending = children.filter((child) => !hasExited(child));
      while (pending.length > 0) {
        await Promise.all(pending.map(waitForExit));
        pending = children.filter((child) => !hasExited(child));
      }
    },
    async waitForClose() {
      let waited = 0;
      while (waited < closures.length) {
        const pending = closures.slice(waited);
        waited = closures.length;
        await Promise.all(pending);
      }
    },
    killRunning(signal = "SIGKILL") {
      for (const child of children) {
        if (child.pid !== undefined && !hasExited(child)) child.kill(signal);
      }
    },
    dispose,
    [Symbol.dispose]: dispose,
  };
}

export interface LifelineHolder {
  readonly label: string;
  readonly pid: number;
  readonly exited: Promise<void>;
  alive(): boolean;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface ProcessLifeline {
  readonly path: string;
  readonly holders: readonly LifelineHolder[];
  holdSource(label: string, onHeld?: string): string;
  waitForHolders(count: number): Promise<readonly LifelineHolder[]>;
  close(): Promise<void>;
}

async function lifelinePath(): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  if (process.platform === "win32") {
    return {
      path: `\\\\.\\pipe\\bb-lifeline-${randomBytes(8).toString("hex")}`,
      cleanup: async () => {},
    };
  }
  const base =
    join(tmpdir(), "bb-lifeline-XXXXXX", "s").length < POSIX_SOCKET_PATH_LIMIT
      ? tmpdir()
      : "/tmp";
  const directory = await mkdtemp(join(base, "bb-lifeline-"));
  return {
    path: join(directory, "s"),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function parseHello(line: string): { label: string; pid: number } | null {
  try {
    const value: unknown = JSON.parse(line);
    if (
      typeof value === "object" &&
      value !== null &&
      "label" in value &&
      "pid" in value &&
      typeof value.label === "string" &&
      typeof value.pid === "number" &&
      Number.isSafeInteger(value.pid)
    ) {
      return { label: value.label, pid: value.pid };
    }
  } catch {}
  return null;
}

export async function createProcessLifeline(): Promise<ProcessLifeline> {
  const { path, cleanup } = await lifelinePath();
  const holders: LifelineHolder[] = [];
  const sockets = new Set<Socket>();
  const waiters = new Set<() => void>();
  const notify = () => {
    for (const waiter of waiters) waiter();
  };
  const server = createServer((socket) => {
    sockets.add(socket);
    let buffered = "";
    let closed = false;
    let resolveExited: () => void = () => {};
    const exited = new Promise<void>((resolvePromise) => {
      resolveExited = resolvePromise;
    });
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    socket.on("close", () => {
      closed = true;
      sockets.delete(socket);
      resolveExited();
    });
    const onData = (chunk: string) => {
      buffered += chunk;
      const newline = buffered.indexOf("\n");
      if (newline === -1) return;
      socket.off("data", onData);
      const hello = parseHello(buffered.slice(0, newline));
      if (hello === null) {
        socket.destroy();
        return;
      }
      holders.push({
        label: hello.label,
        pid: hello.pid,
        exited,
        alive: () => !closed,
        kill(signal = "SIGKILL") {
          if (closed) return false;
          try {
            process.kill(hello.pid, signal);
            return true;
          } catch {
            return false;
          }
        },
      });
      socket.write("held\n");
      notify();
    };
    socket.on("data", onData);
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(path, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  server.unref();
  return {
    path,
    holders,
    holdSource(label, onHeld) {
      const afterWrite =
        onHeld === undefined
          ? "s.unref();"
          : `s.once("data",()=>{s.unref();${onHeld}});`;
      return `{const s=process.getBuiltinModule("node:net").connect(${JSON.stringify(path)});s.on("error",()=>{});s.write(JSON.stringify({label:${JSON.stringify(label)},pid:process.pid})+"\\n");${afterWrite}}`;
    },
    waitForHolders(count) {
      if (holders.length >= count) return Promise.resolve(holders.slice());
      return new Promise((resolveHolders) => {
        const waiter = () => {
          if (holders.length < count) return;
          waiters.delete(waiter);
          resolveHolders(holders.slice());
        };
        waiters.add(waiter);
      });
    },
    async close() {
      for (const holder of holders) holder.kill("SIGKILL");
      await Promise.all(holders.map((holder) => holder.exited));
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolveClose) =>
        server.close(() => resolveClose()),
      );
      await cleanup();
    },
  };
}

export interface DescendantPipe {
  readonly path: string;
  readonly opened: Promise<void>;
  readonly closed: Promise<void>;
  dispose(): Promise<void>;
}

export async function createDescendantPipe(): Promise<DescendantPipe> {
  if (process.platform === "win32") {
    throw new Error("createDescendantPipe needs POSIX named pipes");
  }
  const directory = await mkdtemp(join(tmpdir(), "bb-descendant-pipe-"));
  const path = join(directory, "pipe");
  await new Promise<void>((resolveFifo, rejectFifo) => {
    execFile("mkfifo", [path], (error) =>
      error === null ? resolveFifo() : rejectFifo(error),
    );
  });
  const reader = open(path, "r");
  const closed = reader.then(
    (handle) =>
      new Promise<void>((resolveClosed, rejectClosed) => {
        const stream = handle.createReadStream();
        stream.on("error", rejectClosed);
        stream.on("close", () => resolveClosed());
        stream.resume();
      }),
  );
  let isOpen = false;
  const opened = reader.then(() => {
    isOpen = true;
  });
  return {
    path,
    opened,
    closed,
    async dispose() {
      if (!isOpen) {
        const writer = await open(path, "w");
        await writer.close();
      }
      await closed.catch(() => {});
      await rm(directory, { recursive: true, force: true });
    },
  };
}
