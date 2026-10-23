import { Buffer } from "node:buffer";
import type { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { HOST_DAEMON_TERMINAL_DATA_PATH } from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import type { TerminalUpgradeGrant } from "../services/terminals/terminal-relay.js";
import {
  rejectUpgrade,
  type TerminalUpgrade,
} from "../services/terminals/terminal-relay-transport.js";
import type { ServerLogger } from "../types.js";

const TERMINAL_UPGRADE_GRANT_SLOT = Symbol("terminalUpgradeGrantSlot");

export class TerminalUpgradeGrantSlot {
  grant: TerminalUpgradeGrant | null = null;
}

export function terminalUpgradeGrantSlot(
  env: unknown,
): TerminalUpgradeGrantSlot | null {
  if (typeof env !== "object" || env === null) {
    return null;
  }
  const slot: unknown = Reflect.get(env, TERMINAL_UPGRADE_GRANT_SLOT);
  return slot instanceof TerminalUpgradeGrantSlot ? slot : null;
}

function isTerminalUpgradePath(pathname: string): boolean {
  return (
    pathname.startsWith("/ws/terminals/") ||
    pathname === HOST_DAEMON_TERMINAL_DATA_PATH
  );
}

export function installTerminalUpgradeDispatcher(
  server: EventEmitter,
  args: {
    app: Hono;
    logger: ServerLogger;
    upgrade: (upgrade: TerminalUpgrade) => void;
  },
): void {
  const fallbackListeners = server.listeners("upgrade");
  server.removeAllListeners("upgrade");
  server.on(
    "upgrade",
    (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      let url: URL;
      try {
        url = new URL(request.url ?? "/", "http://localhost");
      } catch {
        rejectUpgrade(socket, 400);
        return;
      }
      if (!isTerminalUpgradePath(url.pathname)) {
        for (const listener of fallbackListeners) {
          Reflect.apply(listener, server, [request, socket, head]);
        }
        return;
      }
      socket.on("error", () => socket.destroy());
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value !== undefined) {
          headers.append(key, Array.isArray(value) ? value.join(", ") : value);
        }
      }
      const slot = new TerminalUpgradeGrantSlot();
      const env = {
        incoming: request,
        outgoing: undefined,
        [TERMINAL_UPGRADE_GRANT_SLOT]: slot,
      };
      void Promise.resolve(args.app.request(url, { headers }, env))
        .then((response) => {
          if (slot.grant === null) {
            rejectUpgrade(socket, response.status);
            return;
          }
          args.upgrade({
            grant: slot.grant,
            head: Buffer.from(head),
            request,
            socket,
          });
        })
        .catch((error: unknown) => {
          args.logger.error({ err: error }, "Terminal upgrade failed");
          rejectUpgrade(socket, 500);
        });
    },
  );
}
