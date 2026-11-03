import { once } from "node:events";
import type { Server } from "node:http";
import * as net from "node:net";
import type { AddressInfo } from "node:net";
import { importGateSigningKey } from "@bb/tunnel-contract/next";
import { createAccountApi, type AccountApi } from "./account-api.js";
import { AssetCache } from "./asset-cache.js";
import {
  createMachineLabelProxy,
  type MachineLabelProxy,
} from "./machine-label.js";
import type { ConnectNextConfig } from "./config.js";
import { createLocalDirectory, type TunnelDirectory } from "./directory.js";
import {
  createFrpConnections,
  type FrpConnections,
} from "./frp-connections.js";
import { createFrpHooks } from "./frp-hooks.js";
import { startFrps, type Frps } from "./frps.js";
import { createGate, type GateDeadlines } from "./gate.js";
import { errorText, type Log } from "./log.js";
import { createPeerServer } from "./peer-server.js";
import { startPresence } from "./presence.js";
import {
  createRegions,
  flyPeerResolver,
  type Regions,
  type RegionsOptions,
  type ResolvePeers,
} from "./regions.js";
import { createSessionRefresher } from "./session-refresh.js";

const LOOPBACK = "127.0.0.1";
const SECURE_SESSION_COOKIE = "__Secure-better-auth.session_token";
const LOCAL_SESSION_COOKIE = "better-auth.session_token";
const SECURE_DESKTOP_SESSION_COOKIE = "__Secure-bb-connect.desktop_session";
const LOCAL_DESKTOP_SESSION_COOKIE = "bb-connect.desktop_session";
const PRESENCE_GOODBYE_MS = 3_000;
const SETTLE_MS = 250;
const DRAIN_MS = 3_000;

export interface ConnectNextOverrides {
  accounts?: AccountApi;
  machineLabels?: MachineLabelProxy;
  directory?: TunnelDirectory;
  deadlines?: GateDeadlines;
  resolvePeers?: ResolvePeers;
  drainMs?: number;
  peerTimings?: Pick<
    RegionsOptions,
    "lookupTimeoutMs" | "announceTimeoutMs" | "helloTimeoutMs" | "negativeMs"
  >;
}

export interface ConnectNext {
  webPort: number;
  frpTcpPort: number | null;
  internalPort: number | null;
  directory: TunnelDirectory;
  regions: Regions | null;
  frpConnections: FrpConnections;
  frps: Frps;
  settlePresence(): Promise<void>;
  stop(): Promise<void>;
}

async function listen(server: net.Server, port: number, host: string) {
  server.listen(port, host);
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

function closeServer(server: Server | net.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    if ("closeAllConnections" in server) server.closeAllConnections();
  });
}

function stopListening(server: net.Server): void {
  if (server.listening) server.close();
}

export async function startConnectNext(
  config: ConnectNextConfig,
  log: Log,
  overrides: ConnectNextOverrides = {},
): Promise<ConnectNext> {
  const accounts =
    overrides.accounts ??
    createAccountApi({
      baseUrl: config.accountApiUrl,
      secret: config.gateSecret,
      onRevalidateFailed: (error) =>
        log("warn", "account_revalidate_failed", { error: errorText(error) }),
    });
  const local = overrides.directory ?? createLocalDirectory();
  const frpConnections = createFrpConnections();
  const regions =
    config.peers === null
      ? null
      : createRegions({
          local,
          self: { machineId: config.gateMachineId, region: config.region },
          secret: config.peers.secret,
          resolvePeers:
            overrides.resolvePeers ??
            flyPeerResolver(config.peers.appName, config.peers.internalPort),
          refreshMs: config.peers.refreshMs,
          log,
          ...overrides.peerTimings,
        });
  regions?.onSuperseded((label) => {
    const closed = frpConnections.close(label);
    log("info", "frp_client_closed", { label, connections: closed });
  });
  const directory = regions?.directory ?? local;
  const signingKey = await importGateSigningKey(config.signingKeyJwk);
  const secure = config.scheme === "https";
  const hooks = createFrpHooks({
    accounts,
    directory,
    log,
    onLogin: (clientAddress, label) =>
      frpConnections.loggedIn(clientAddress, label),
    clientConnected: (label) => frpConnections.count(label) > 0,
  });
  const hooksPort = await listen(hooks.server, config.ports.hooks, LOOPBACK);
  const frps = await startFrps({
    binary: config.frps,
    bindPort: config.ports.frpBind,
    vhostPort: config.ports.vhost,
    hooksPort,
    subdomainHost: config.baseDomain,
    logLevel: config.frpLogLevel,
    log,
  });
  const sessionCookieName = secure
    ? SECURE_SESSION_COOKIE
    : LOCAL_SESSION_COOKIE;
  const gate = createGate({
    policy: {
      baseDomain: config.baseDomain,
      scheme: config.scheme,
      accountAppUrl: config.accountAppUrl,
      sessionCookieName,
      desktopSessionCookieName: secure
        ? SECURE_DESKTOP_SESSION_COOKIE
        : LOCAL_DESKTOP_SESSION_COOKIE,
      assetLinksFingerprints: config.assetLinksFingerprints,
    },
    refreshSession: createSessionRefresher({
      accountAppUrl: config.accountAppUrl,
      sessionCookieName,
      log,
    }),
    routing: regions?.routing ?? null,
    frpConnections,
    accounts,
    machineLabels:
      overrides.machineLabels ??
      createMachineLabelProxy({ accountApiUrl: config.accountApiUrl }),
    directory,
    signingKey,
    cache: new AssetCache({
      maxBytes: config.cacheMaxBytes,
      maxEntryBytes: config.cacheMaxEntryBytes,
    }),
    vhost: { host: LOOPBACK, port: config.ports.vhost },
    frpBind: { host: LOOPBACK, port: config.ports.frpBind },
    log,
    ...(overrides.deadlines === undefined
      ? {}
      : { deadlines: overrides.deadlines }),
  });
  const presence = startPresence({
    accounts,
    directory,
    region: config.region,
    gateMachineId: config.gateMachineId,
    refreshMs: config.presenceRefreshMs,
    log,
  });
  const peerServer =
    regions === null
      ? null
      : createPeerServer({
          regions,
          directory,
          baseDomain: config.baseDomain,
          vhost: { host: LOOPBACK, port: config.ports.vhost },
          log,
        });
  let internalPort: number | null = null;
  if (peerServer !== null && regions !== null && config.peers !== null) {
    internalPort = await listen(
      peerServer.server,
      config.peers.internalPort,
      config.peers.internalBindHost,
    );
    await regions.start();
  }
  const webPort = await listen(gate.server, config.ports.web, config.bindHost);
  let frpTcp: net.Server | null = null;
  let frpTcpPort: number | null = null;
  if (config.ports.frpTcp !== null) {
    frpTcp = net.createServer((socket) => {
      const frpsSocket = net.connect(config.ports.frpBind, LOOPBACK, () =>
        frpConnections.track(`${LOOPBACK}:${frpsSocket.localPort}`, [
          socket,
          frpsSocket,
        ]),
      );
      socket.on("error", () => frpsSocket.destroy());
      frpsSocket.on("error", () => socket.destroy());
      socket.pipe(frpsSocket).pipe(socket);
    });
    frpTcpPort = await listen(frpTcp, config.ports.frpTcp, config.bindHost);
  }
  log("info", "gate_started", {
    baseDomain: config.baseDomain,
    webPort,
    frpTcpPort,
    internalPort,
    peers: regions?.peerCount() ?? null,
    region: config.region,
  });
  return {
    webPort,
    frpTcpPort,
    internalPort,
    directory,
    regions,
    frpConnections,
    frps,
    settlePresence: () => presence.settle(),
    async stop() {
      const startedAt = Date.now();
      const goodbyes = Promise.all([
        presence.stop(PRESENCE_GOODBYE_MS),
        regions?.stop(PRESENCE_GOODBYE_MS),
      ]);
      const drainMs =
        regions !== null && regions.peerCount() > 0
          ? (overrides.drainMs ?? DRAIN_MS)
          : 0;
      if (drainMs > 0) gate.drain();
      else stopListening(gate.server);
      if (frpTcp !== null) stopListening(frpTcp);
      if (peerServer !== null) stopListening(peerServer.server);
      gate.server.closeIdleConnections();
      const frpClients = frpConnections.closeAll();
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(drainMs, SETTLE_MS)),
      );
      stopListening(gate.server);
      gate.dropConnections();
      peerServer?.server.closeAllConnections();
      frpTcp?.close();
      await goodbyes;
      await frps.stop();
      await Promise.all([
        closeServer(gate.server),
        closeServer(hooks.server),
        ...(peerServer === null ? [] : [closeServer(peerServer.server)]),
        ...(frpTcp === null ? [] : [closeServer(frpTcp)]),
      ]);
      gate.close();
      peerServer?.close();
      log("info", "gate_stopped", {
        frpClients,
        drainMs,
        ms: Date.now() - startedAt,
      });
    },
  };
}
