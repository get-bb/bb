import { STATUS_CODES, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { ServerType } from "@hono/node-server";
import type { Logger } from "@bb/logger";
import { HOST_DAEMON_TERMINAL_DATA_PATH } from "@bb/host-daemon-contract";
import type { Hono } from "hono";

export const TERMINAL_UPGRADE_GRANT = Symbol("bb.terminal-upgrade-grant");
export type TerminalUpgradeGrant =
  | {
      kind: "browser";
      outputAcks: boolean;
      sinceSeq: number;
      terminalId: string;
    }
  | { kind: "daemon-data"; hostId: string; sessionId: string };

type GrantHolder = { grant: TerminalUpgradeGrant | null };
const holders = new WeakMap<object, GrantHolder>();

export function setTerminalUpgradeGrant(
  env: unknown,
  grant: TerminalUpgradeGrant,
): void {
  if (typeof env !== "object" || env === null)
    throw new Error("Missing terminal upgrade environment");
  const holder = holders.get(env);
  if (!holder)
    throw new Error("Terminal upgrade route requires the upgrade dispatcher");
  holder.grant = grant;
}

export type UpgradeDispatcherOptions = {
  app: Hono;
  logger: Pick<Logger, "error">;
  onTerminalUpgrade(args: {
    grant: TerminalUpgradeGrant;
    head: Buffer;
    request: IncomingMessage;
    socket: Duplex;
  }): boolean;
};

function reject(socket: Duplex, status: number): void {
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ""}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}
export function installUpgradeDispatcher(
  server: ServerType,
  options: UpgradeDispatcherOptions,
): () => void {
  const listeners = server.listeners("upgrade");
  if (listeners.length !== 1)
    throw new Error("Expected one node-ws upgrade listener");
  const original = listeners[0];
  if (!original) throw new Error("Missing node-ws upgrade listener");
  server.removeAllListeners("upgrade");
  const dispatch = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://localhost");
    } catch {
      reject(socket, 400);
      return;
    }
    if (
      !url.pathname.startsWith("/ws/terminals/") &&
      url.pathname !== HOST_DAEMON_TERMINAL_DATA_PATH
    ) {
      original.apply(server, [request, socket, head]);
      return;
    }
    const copiedHead = Buffer.from(head);
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value)
        headers.append(key, Array.isArray(value) ? (value[0] ?? "") : value);
    }
    const holder: GrantHolder = { grant: null };
    const env = {
      incoming: request,
      outgoing: undefined,
      [TERMINAL_UPGRADE_GRANT]: holder,
    };
    holders.set(env, holder);
    void Promise.resolve(options.app.request(url, { headers }, env))
      .then((response) => {
        if (!holder.grant) {
          reject(socket, response.status);
          return;
        }
        if (
          !options.onTerminalUpgrade({
            grant: holder.grant,
            head: copiedHead,
            request,
            socket,
          })
        ) {
          reject(socket, 503);
        }
      })
      .catch((error: unknown) => {
        options.logger.error(
          { err: error },
          "Terminal upgrade dispatch failed",
        );
        reject(socket, 500);
      });
  };
  server.on("upgrade", dispatch);
  return () => {
    server.removeListener("upgrade", dispatch);
    server.on("upgrade", (request, socket, head) => {
      original.apply(server, [request, socket, head]);
    });
  };
}
