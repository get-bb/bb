import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { extname } from "node:path";
import { experimental_readBoundedLines } from "@get-bb/plugin-sdk/provider-bridge";

export const PI_CHANNEL_PIPE_ENV = "BB_PI_BRIDGE_CHANNEL_PIPE";

const MAX_CHANNEL_PIPE_PENDING_WRITES = 10_000;

const WINDOWS_BATCH_EXTENSIONS = new Set([".bat", ".cmd"]);

export function piLaunchRequiresWindowsShell(
  command: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "win32") {
    return false;
  }
  const extension = extname(command).toLowerCase();
  return extension === "" || WINDOWS_BATCH_EXTENSIONS.has(extension);
}

export function planPiChildKill(args: {
  windowsShellChild: boolean;
  platform: NodeJS.Platform;
}): { signal: NodeJS.Signals | null; escalateImmediately: boolean } {
  if (args.windowsShellChild) {
    return { signal: null, escalateImmediately: true };
  }
  return {
    signal: args.platform === "win32" ? null : "SIGTERM",
    escalateImmediately: false,
  };
}

export interface WindowsShellKillSpawn {
  (
    command: string,
    args: readonly string[],
    options: { stdio: "ignore"; windowsHide: boolean },
  ): { on(event: "error", listener: (error: Error) => void): unknown };
}

export function escalateWindowsShellChildKill(args: {
  pid: number | undefined;
  killFallback: (signal: NodeJS.Signals) => unknown;
  spawnProcess?: WindowsShellKillSpawn;
}): void {
  const { pid } = args;
  if (pid === undefined) {
    return;
  }
  const spawnProcess = args.spawnProcess ?? spawn;
  try {
    const taskkill = spawnProcess(
      "taskkill",
      ["/pid", String(pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    taskkill.on("error", () => {
      args.killFallback("SIGKILL");
    });
  } catch {
    args.killFallback("SIGKILL");
  }
}

export class WindowsChannelPipe {
  readonly pipePath: string;
  private readonly server: Server;
  private socket: Socket | null = null;
  private readonly pendingWrites: string[] = [];

  constructor(onLine: (line: string) => void) {
    this.pipePath = `\\\\.\\pipe\\bb-pi-${process.pid}-${randomUUID()}`;
    this.server = createServer((socket) => {
      if (this.socket !== null) {
        socket.destroy();
        return;
      }
      this.socket = socket;
      socket.on("error", () => undefined);
      socket.on("close", () => {
        if (this.socket === socket) {
          this.socket = null;
        }
      });
      experimental_readBoundedLines({
        input: socket,
        onLine,
        onOverflow: (bytes) => {
          process.stderr.write(
            `pi bridge: dropped a ${bytes}-byte channel line\n`,
          );
        },
      });
      for (const line of this.pendingWrites.splice(0)) {
        socket.write(line);
      }
    });
    this.server.on("error", () => undefined);
    this.server.listen(this.pipePath);
    this.server.unref();
  }

  write(line: string): void {
    const socket = this.socket;
    if (socket === null || socket.destroyed || socket.writableEnded) {
      if (this.pendingWrites.length >= MAX_CHANNEL_PIPE_PENDING_WRITES) {
        process.stderr.write(
          `pi bridge: dropped a channel line; ${MAX_CHANNEL_PIPE_PENDING_WRITES} pending writes buffered\n`,
        );
        return;
      }
      this.pendingWrites.push(line);
      return;
    }
    socket.write(line);
  }

  endWrites(): void {
    const socket = this.socket;
    if (socket !== null && !socket.destroyed && !socket.writableEnded) {
      socket.end();
    }
  }

  close(): void {
    this.socket?.destroy();
    this.socket = null;
    this.server.close();
  }
}

export interface WindowsShellChildPlan {
  channel: WindowsChannelPipe;
  env: NodeJS.ProcessEnv;
  stdio: ["pipe", "pipe", "pipe"];
}

export function planWindowsShellChild(args: {
  command: string;
  env: NodeJS.ProcessEnv;
  onLine: (line: string) => void;
}): WindowsShellChildPlan | null {
  if (!piLaunchRequiresWindowsShell(args.command)) {
    return null;
  }
  const channel = new WindowsChannelPipe(args.onLine);
  return {
    channel,
    env: { ...args.env, [PI_CHANNEL_PIPE_ENV]: channel.pipePath },
    stdio: ["pipe", "pipe", "pipe"],
  };
}
