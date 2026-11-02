import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { experimental_readBoundedLines } from "@get-bb/plugin-sdk/provider-bridge";

export const PI_BRIDGE_CHANNEL_ENV = "BB_PI_BRIDGE_CHANNEL";
export const PI_BRIDGE_CHANNEL_TOKEN_ENV = "BB_PI_BRIDGE_CHANNEL_TOKEN";

interface PiBridgeChannelHandlers {
  onLine: (line: string) => void;
  onOverflow: (bytes: number) => void;
  onError: (error: Error) => void;
}

function listenAddress(): { address: string; directory: string | null } {
  if (process.platform === "win32") {
    return { address: `\\\\.\\pipe\\bb-pi-${randomUUID()}`, directory: null };
  }
  const directory = mkdtempSync(path.join(os.tmpdir(), "bb-pi-"));
  return { address: path.join(directory, "channel.sock"), directory };
}

export class PiBridgeChannel {
  readonly env: Record<string, string>;
  private readonly token = Buffer.from(randomBytes(32).toString("hex"));
  private readonly server = createServer((socket) => this.accept(socket));
  private readonly directory: string | null;
  private readonly candidates = new Set<Socket>();
  private socket: Socket | null = null;
  private queued: string[] = [];
  private ended = false;
  private closed = false;

  constructor(private readonly handlers: PiBridgeChannelHandlers) {
    const { address, directory } = listenAddress();
    this.directory = directory;
    this.env = {
      [PI_BRIDGE_CHANNEL_ENV]: address,
      [PI_BRIDGE_CHANNEL_TOKEN_ENV]: this.token.toString(),
    };
    this.server.on("error", (error) => {
      if (!this.closed) handlers.onError(error);
    });
    this.server.listen(address);
  }

  write(line: string): boolean {
    if (this.ended || this.closed) {
      return false;
    }
    if (this.socket === null) {
      this.queued.push(line);
    } else {
      this.socket.write(line);
    }
    return true;
  }

  end(): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.socket?.end();
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.queued = [];
    this.server.close();
    for (const socket of this.candidates) socket.destroy();
    this.candidates.clear();
    this.socket?.destroy();
    if (this.directory !== null) {
      rmSync(this.directory, { recursive: true, force: true });
    }
  }

  private accept(socket: Socket): void {
    socket.on("error", () => undefined);
    if (this.closed || this.socket !== null) {
      socket.destroy();
      return;
    }
    this.candidates.add(socket);
    socket.once("close", () => this.candidates.delete(socket));
    let authenticated = false;
    experimental_readBoundedLines({
      input: socket,
      onLine: (line) => {
        if (authenticated) {
          this.handlers.onLine(line);
          return;
        }
        if (this.socket !== null || !this.isToken(line)) {
          socket.destroy();
          return;
        }
        authenticated = true;
        this.attach(socket);
      },
      onOverflow: (bytes) => {
        if (authenticated) {
          this.handlers.onOverflow(bytes);
        } else {
          socket.destroy();
        }
      },
    });
  }

  private isToken(line: string): boolean {
    const candidate = Buffer.from(line);
    return (
      candidate.length === this.token.length &&
      timingSafeEqual(candidate, this.token)
    );
  }

  private attach(socket: Socket): void {
    this.socket = socket;
    this.candidates.delete(socket);
    for (const candidate of this.candidates) candidate.destroy();
    this.candidates.clear();
    this.server.close();
    for (const line of this.queued.splice(0)) socket.write(line);
    if (this.ended) {
      socket.end();
    }
  }
}
