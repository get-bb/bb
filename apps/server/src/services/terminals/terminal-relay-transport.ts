import { Buffer } from "node:buffer";
import { fork, type ChildProcess } from "node:child_process";
import { IncomingMessage, STATUS_CODES } from "node:http";
import { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  hostDaemonTerminalDataDaemonMessageSchema,
  hostDaemonTerminalDataServerMessageSchema,
} from "@bb/host-daemon-contract";
import { terminalSessionSchema } from "@bb/server-contract";
import { WebSocket, WebSocketServer } from "ws";
import { closeWebSocketServer } from "../../ws/close-websocket-server.js";
import { z } from "zod";
import type { ServerLogger } from "../../types.js";
import {
  TerminalRelay,
  type TerminalRelayControl,
  type TerminalRelayHost,
  type TerminalRelaySocket,
  type TerminalUpgradeGrant,
} from "./terminal-relay.js";

const DAEMON_SOCKET_PING_INTERVAL_MS = 20_000;
const RELAY_RESTART_MIN_DELAY_MS = 250;
const RELAY_RESTART_MAX_DELAY_MS = 10_000;

export interface TerminalUpgrade {
  grant: TerminalUpgradeGrant;
  head: Buffer;
  request: IncomingMessage;
  socket: Duplex;
}

export interface TerminalRelayEndpoint {
  readonly control: TerminalRelayControl;
  bindHost(host: TerminalRelayHost): void;
  close(): Promise<void>;
  upgrade(upgrade: TerminalUpgrade): void;
}

const terminalRelayTerminalSchema = z.object({
  daemonSessionId: z.string().nullable(),
  session: terminalSessionSchema,
});

const terminalUpgradeGrantSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("browser"),
    outputAcks: z.boolean(),
    sinceSeq: z.number().int().nonnegative(),
    terminal: terminalRelayTerminalSchema.nullable(),
    terminalId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("daemon"),
    daemonSessionId: z.string().min(1),
  }),
]);

const mainToRelayMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("upgrade"),
    grant: terminalUpgradeGrantSchema,
    headBase64: z.string(),
    request: z.object({
      headers: z.record(
        z.string(),
        z.union([z.string(), z.array(z.string())]).optional(),
      ),
      method: z.string(),
      url: z.string(),
    }),
  }),
  z.object({
    type: z.literal("publish"),
    update: z.object({
      kind: z.enum(["exited", "session-updated"]),
      terminal: terminalRelayTerminalSchema,
    }),
  }),
  z.object({
    type: z.literal("daemon-control-message"),
    daemonSessionId: z.string().min(1),
    message: hostDaemonTerminalDataDaemonMessageSchema,
  }),
  z.object({
    type: z.literal("close-daemon-session"),
    daemonSessionId: z.string().min(1),
  }),
]);
type MainToRelayMessage = z.infer<typeof mainToRelayMessageSchema>;

const relayToMainMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({
    type: z.literal("record-exit"),
    daemonSessionId: z.string().min(1),
    message: hostDaemonTerminalDataDaemonMessageSchema,
  }),
  z.object({
    type: z.literal("record-input"),
    hasData: z.boolean(),
    terminalId: z.string().min(1),
  }),
  z.object({
    type: z.literal("record-resize"),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    terminalId: z.string().min(1),
  }),
  z.object({
    type: z.literal("send-daemon-control-message"),
    daemonSessionId: z.string().min(1),
    message: hostDaemonTerminalDataServerMessageSchema,
  }),
]);
type RelayToMainMessage = z.infer<typeof relayToMainMessageSchema>;

export function rejectUpgrade(socket: Duplex, status: number): void {
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ""}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

function createTerminalUpgradeAcceptor(relay: TerminalRelay): {
  accept: (upgrade: TerminalUpgrade) => void;
  close: () => Promise<void>;
} {
  const wss = new WebSocketServer({ noServer: true });
  const accept = (upgrade: TerminalUpgrade): void => {
    wss.handleUpgrade(upgrade.request, upgrade.socket, upgrade.head, (ws) => {
      const socket: TerminalRelaySocket = {
        close: (code, reason) => ws.close(code, reason),
        raw: ws,
        send: (data) => {
          if (ws.readyState !== WebSocket.OPEN) {
            throw new Error("Terminal relay socket is not open");
          }
          ws.send(data);
        },
      };
      const { grant } = upgrade;
      ws.on("message", (data) => relay.message(grant, socket, data));
      ws.on("close", () => relay.close(grant, socket));
      ws.on("error", () => undefined);
      if (grant.kind === "daemon") {
        let alive = true;
        ws.on("pong", () => {
          alive = true;
        });
        const ping = setInterval(() => {
          if (!alive) {
            ws.terminate();
            return;
          }
          alive = false;
          ws.ping();
        }, DAEMON_SOCKET_PING_INTERVAL_MS);
        ping.unref();
        ws.on("close", () => clearInterval(ping));
      }
      relay.open(grant, socket);
    });
  };
  let closing: Promise<void> | null = null;
  return { accept, close: () => (closing ??= closeWebSocketServer(wss)) };
}

export function createInProcessTerminalRelay(
  options: { attachTimeoutMs?: number } = {},
): TerminalRelayEndpoint & { readonly relay: TerminalRelay } {
  const relay = new TerminalRelay(options);
  const acceptor = createTerminalUpgradeAcceptor(relay);
  return {
    control: relay,
    relay,
    bindHost: (host) => relay.bindHost(host),
    close: acceptor.close,
    upgrade: acceptor.accept,
  };
}

export interface TerminalRelayRouter extends TerminalRelayEndpoint {
  reconcile(): void;
}

export function createTerminalRelayRouter(options: {
  inProcess: TerminalRelayEndpoint;
  startProcess: () => TerminalRelayEndpoint;
  useProcess: () => boolean;
}): TerminalRelayRouter {
  const { inProcess } = options;
  let host: TerminalRelayHost | null = null;
  let processRelay: TerminalRelayEndpoint | null = null;
  const terminalPlacements = new Map<string, "in-process" | "process">();

  const startProcess = (): TerminalRelayEndpoint => {
    if (processRelay === null) {
      processRelay = options.startProcess();
      if (host !== null) {
        processRelay.bindHost(host);
      }
    }
    return processRelay;
  };

  const reconcile = (): void => {
    if (options.useProcess()) {
      startProcess();
      return;
    }
    if (
      processRelay !== null &&
      ![...terminalPlacements.values()].includes("process")
    ) {
      void processRelay.close();
      processRelay = null;
    }
  };

  const relayForTerminal = (terminalId: string): TerminalRelayEndpoint =>
    processRelay !== null && terminalPlacements.get(terminalId) === "process"
      ? processRelay
      : inProcess;

  const relays = (): TerminalRelayEndpoint[] =>
    processRelay === null ? [inProcess] : [inProcess, processRelay];

  const router: TerminalRelayRouter = {
    control: {
      closeDaemonSession: (daemonSessionId) => {
        for (const relay of relays()) {
          relay.control.closeDaemonSession(daemonSessionId);
        }
      },
      handleDaemonControlMessage: (args) => {
        relayForTerminal(args.message.terminalId).control.handleDaemonControlMessage(
          args,
        );
      },
      publishSession: (update) => {
        const terminalId = update.terminal.session.id;
        relayForTerminal(terminalId).control.publishSession(update);
        if (update.kind === "exited" && terminalPlacements.delete(terminalId)) {
          reconcile();
        }
      },
    },
    bindHost: (nextHost) => {
      host = nextHost;
      for (const relay of relays()) {
        relay.bindHost(nextHost);
      }
    },
    close: async () => {
      const closing = relays().map((relay) => relay.close());
      processRelay = null;
      await Promise.all(closing);
    },
    reconcile,
    upgrade: (upgrade) => {
      const { grant } = upgrade;
      if (grant.kind === "daemon") {
        if (processRelay === null) {
          rejectUpgrade(upgrade.socket, 503);
          return;
        }
        processRelay.upgrade(upgrade);
        return;
      }
      const placement =
        terminalPlacements.get(grant.terminalId) ??
        (options.useProcess() ? "process" : "in-process");
      if (grant.terminal !== null && grant.terminal.session.status !== "exited") {
        terminalPlacements.set(grant.terminalId, placement);
      }
      (placement === "process" ? startProcess() : inProcess).upgrade(upgrade);
    },
  };
  reconcile();
  return router;
}

function handleRelayMessage(
  host: TerminalRelayHost,
  message: RelayToMainMessage,
): void {
  switch (message.type) {
    case "ready":
      return;
    case "record-exit":
      if (message.message.type === "terminal.exited") {
        host.recordExit({
          daemonSessionId: message.daemonSessionId,
          message: message.message,
        });
      }
      return;
    case "record-input":
      host.recordInput(message);
      return;
    case "record-resize":
      host.recordResize(message);
      return;
    case "send-daemon-control-message":
      host.sendDaemonControlMessage(message);
      return;
  }
}

export function startTerminalRelayProcess(options: {
  entryUrl: URL;
  execArgv?: string[];
  logger: ServerLogger;
}): TerminalRelayEndpoint {
  let host: TerminalRelayHost | null = null;
  let child: ChildProcess | null = null;
  let stopped = false;
  let restartDelayMs = RELAY_RESTART_MIN_DELAY_MS;
  const execArgv =
    options.execArgv ??
    process.execArgv.filter((arg) => !arg.startsWith("--inspect"));

  const spawn = (): void => {
    const next = fork(fileURLToPath(options.entryUrl), [], {
      execArgv,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    child = next;
    next.on("message", (raw) => {
      const parsed = relayToMainMessageSchema.safeParse(raw);
      if (!parsed.success) {
        options.logger.warn(
          { err: parsed.error },
          "Ignoring invalid terminal relay message",
        );
        return;
      }
      if (parsed.data.type === "ready") {
        restartDelayMs = RELAY_RESTART_MIN_DELAY_MS;
      }
      if (host !== null) {
        handleRelayMessage(host, parsed.data);
      }
    });
    next.on("error", (error) => {
      options.logger.warn({ err: error }, "Terminal relay process error");
    });
    next.on("exit", (code, signal) => {
      if (child === next) {
        child = null;
      }
      if (stopped) {
        return;
      }
      options.logger.warn(
        { code, restartDelayMs, signal },
        "Terminal relay exited; restarting",
      );
      setTimeout(spawn, restartDelayMs).unref();
      restartDelayMs = Math.min(restartDelayMs * 2, RELAY_RESTART_MAX_DELAY_MS);
    });
  };

  const send = (message: MainToRelayMessage, handle?: Socket): boolean => {
    if (!child?.connected) {
      return false;
    }
    child.send(message, handle);
    return true;
  };

  spawn();
  return {
    control: {
      closeDaemonSession: (daemonSessionId) => {
        send({ type: "close-daemon-session", daemonSessionId });
      },
      handleDaemonControlMessage: (args) => {
        send({ type: "daemon-control-message", ...args });
      },
      publishSession: (update) => {
        send({ type: "publish", update });
      },
    },
    bindHost: (nextHost) => {
      host = nextHost;
    },
    close: () => {
      stopped = true;
      child?.kill();
      return Promise.resolve();
    },
    upgrade: (upgrade) => {
      const { request, socket } = upgrade;
      if (!(socket instanceof Socket)) {
        rejectUpgrade(socket, 500);
        return;
      }
      const sent = send(
        {
          type: "upgrade",
          grant: upgrade.grant,
          headBase64: upgrade.head.toString("base64"),
          request: {
            headers: request.headers,
            method: request.method ?? "GET",
            url: request.url ?? "/",
          },
        },
        socket,
      );
      if (!sent) {
        rejectUpgrade(socket, 503);
      }
    },
  };
}

export function runTerminalRelayChild(): void {
  const relay = new TerminalRelay();
  const { accept } = createTerminalUpgradeAcceptor(relay);
  const send = (message: RelayToMainMessage): void => {
    process.send?.(message);
  };
  relay.bindHost({
    recordExit: (args) => send({ type: "record-exit", ...args }),
    recordInput: (args) => send({ type: "record-input", ...args }),
    recordResize: (args) => send({ type: "record-resize", ...args }),
    sendDaemonControlMessage: (args) =>
      send({ type: "send-daemon-control-message", ...args }),
  });
  process.on("message", (raw, handle) => {
    const parsed = mainToRelayMessageSchema.safeParse(raw);
    if (!parsed.success) {
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case "upgrade": {
        if (!(handle instanceof Socket)) {
          return;
        }
        const request = new IncomingMessage(handle);
        request.headers = message.request.headers;
        request.method = message.request.method;
        request.url = message.request.url;
        accept({
          grant: message.grant,
          head: Buffer.from(message.headBase64, "base64"),
          request,
          socket: handle,
        });
        return;
      }
      case "publish":
        relay.publishSession(message.update);
        return;
      case "daemon-control-message":
        relay.handleDaemonControlMessage(message);
        return;
      case "close-daemon-session":
        relay.closeDaemonSession(message.daemonSessionId);
        return;
    }
  });
  process.on("disconnect", () => process.exit(0));
  send({ type: "ready" });
}
