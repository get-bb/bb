import { mkdtemp, rm } from "node:fs/promises";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RelayTerminalDataPlane } from "../../src/services/terminals/terminal-data-plane-relay.js";
import { TerminalRelaySupervisor } from "../../src/terminal-relay/terminal-relay-supervisor.js";
import type { TerminalRelayToMainMessage } from "../../src/terminal-relay/terminal-relay-ipc.js";
import {
  startTestServer,
  testLogger,
  type RunningTestServer,
} from "./test-app.js";
import { createTerminalSession, type TerminalSessionRow } from "@bb/db";
import { seedHostSession } from "./seed.js";
import { FakeDaemonDataSocket } from "./fake-daemon-data-socket.js";
export interface RunningRelayTestServer extends RunningTestServer {
  supervisor: TerminalRelaySupervisor;
  readonly relayPid: number;
  readyAt: number[];
  handoffs: {
    kind: "browser" | "daemon-data";
    paused: boolean;
    dataListeners: number;
  }[];
}

export interface TerminalTestFixture {
  server: RunningTestServer;
  relay: RunningRelayTestServer | null;
  daemon: FakeDaemonDataSocket;
  terminal: TerminalSessionRow;
  close(): Promise<void>;
}

export async function startRelayTestServer(): Promise<RunningRelayTestServer> {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-relay-test-"));
  let server: RunningTestServer | null = null;
  let plane: RelayTerminalDataPlane;
  let relayPid = 0;
  const readyAt: number[] = [];
  const handedOffSockets = new Set<Socket>();
  const handoffs: RunningRelayTestServer["handoffs"] = [];
  const supervisor = new TerminalRelaySupervisor({
    entryPath: fileURLToPath(
      new URL(
        "../../src/terminal-relay/terminal-relay-main.ts",
        import.meta.url,
      ),
    ),
    env: { ...process.env, BB_DATA_DIR: dataDir },
    execArgv: [...process.execArgv, "--conditions=source", "--import", "tsx"],
    execPath: process.execPath,
    logger: testLogger,
    onRestart: () => {
      plane.reset();
      server?.deps.terminalSessions.resendRelayState();
      supervisor.send({ type: "move-fence", pending: false });
    },
    onMessage: (message: TerminalRelayToMainMessage) => {
      if (!server) return;
      const terminalSessions = server.deps.terminalSessions;
      switch (message.type) {
        case "ready":
          relayPid = message.pid;
          readyAt.push(Date.now());
          return;
        case "attach-requested":
          supervisor.send({
            type: "attach-decision",
            socketId: message.socketId,
            ...terminalSessions.decideRelayAttach(message.terminalId),
          });
          return;
        case "browser-input":
          terminalSessions.onRelayBrowserInput({
            terminalId: message.terminalId,
            dataBase64: message.dataBase64,
            socket: plane.socketForId(message.socketId),
          });
          return;
        case "browser-resize":
          terminalSessions.onRelayBrowserResize({
            terminalId: message.terminalId,
            cols: message.cols,
            rows: message.rows,
            socket: plane.socketForId(message.socketId),
          });
          return;
        case "daemon-data-socket-opened":
          plane.daemonOpened(message.sessionId);
          terminalSessions.onDaemonDataSocketOpened(message.sessionId);
          return;
        case "daemon-data-socket-closed":
          plane.daemonClosed(message.sessionId);
          terminalSessions.onDaemonDataSocketClosed(message.sessionId);
          return;
        case "terminal-exited":
          terminalSessions.onTerminalExited(message);
          return;
        case "attach-error":
          terminalSessions.onAttachError(message);
          return;
        case "replay":
          terminalSessions.onReplay({
            daemonSessionId: message.daemonSessionId,
            message: {
              type: "terminal.replay",
              requestId: message.requestId,
              terminalId: message.terminalId,
              chunks: message.chunks,
              replayStartSeq: message.replayStartSeq,
              nextSeq: message.nextSeq,
            },
          });
          return;
        case "daemon-send-failed":
          terminalSessions.onDaemonSendFailed(message.sessionId);
          return;
        case "metrics":
          plane.updateClients(message.clients);
          return;
      }
    },
  });
  try {
    server = await startTestServer(
      {
        terminalDataPlane: () => {
          plane = new RelayTerminalDataPlane(supervisor);
          return plane;
        },
        sendRelayDaemonDataMessage: (sessionId, message) =>
          plane.sendDaemonDataMessage(sessionId, message),
      },
      {
        dispatcher: true,
        transferredSockets: true,
        onTerminalUpgrade: ({ grant, head, request }) => {
          if (!supervisor.isReady()) return false;
          const headers = Object.fromEntries(
            Object.entries(request.headers)
              .filter(
                (entry): entry is [string, string | string[]] =>
                  entry[1] !== undefined,
              )
              .map(([key, value]) => [
                key,
                Array.isArray(value) ? value.join(", ") : value,
              ]),
          );
          request.socket.pause();
          handedOffSockets.add(request.socket);
          request.socket.once("close", () =>
            handedOffSockets.delete(request.socket),
          );
          handoffs.push({
            kind: grant.kind,
            paused: request.socket.isPaused(),
            dataListeners: request.socket.listenerCount("data"),
          });
          const details = {
            head: head.toString("base64"),
            headers,
            method: request.method ?? "GET",
            url: request.url ?? "/",
          };
          return supervisor.send(
            grant.kind === "browser"
              ? { type: "accept-browser", grant, ...details }
              : { type: "accept-daemon-data", grant, ...details },
            request.socket,
          );
        },
      },
    );
    await supervisor.start();
    const running = server;
    return {
      ...running,
      supervisor,
      get relayPid() {
        return relayPid;
      },
      readyAt,
      handoffs,
      async close() {
        await supervisor.stop();
        for (const socket of handedOffSockets) socket.destroy();
        await running.close();
        await rm(dataDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await supervisor.stop();
    await server?.close();
    await rm(dataDir, { recursive: true, force: true });
    throw error;
  }
}

export async function startTerminalTestFixture(
  relayOn: boolean,
): Promise<TerminalTestFixture> {
  const relay = relayOn ? await startRelayTestServer() : null;
  const server = relay ?? (await startTestServer());
  const { host, session } = seedHostSession(server.deps);
  const terminal = createTerminalSession(server.db, {
    cols: 80,
    daemonSessionId: session.id,
    environmentId: null,
    hostId: host.id,
    initialCwd: "/tmp",
    rows: 24,
    status: "running",
    threadId: null,
    title: "Echo",
  });
  const daemon = new FakeDaemonDataSocket(server.baseUrl, host.id, session.id);
  try {
    await daemon.connect();
  } catch (error) {
    await daemon.close();
    await server.close();
    throw error;
  }
  return {
    server,
    relay,
    daemon,
    terminal,
    async close() {
      await daemon.close();
      await server.close();
    },
  };
}
