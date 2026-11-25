import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { serverRouteKindSchema } from "@bb/domain";
import {
  orderServerRoutes,
  probeServerRoute,
  selectServerRoute,
  serverRouteKey,
} from "@bb/server-routes";
import type {
  HostDaemonServerRoutes,
  HostDaemonSessionRoute,
} from "@bb/host-daemon-contract";
import type { HostDaemonLogger } from "./logger.js";
import { writeFileAtomically } from "./server-move/fs.js";
import { runtimeErrorLogFields } from "./error-utils.js";
import { usesSecureInternalFetchTransport } from "./server-client.js";

const SERVER_ROUTES_FILE = "server-routes.json";

const persistedServerRoutesSchema = z
  .object({
    anchorUrl: z.string().url(),
    serverId: z.string().min(1),
    routes: z.array(
      z
        .object({
          providerId: z.string().min(1),
          kind: serverRouteKindSchema,
          url: z.string().url(),
          headers: z.record(z.string(), z.string()),
        })
        .strict(),
    ),
  })
  .strict();
export type PersistedServerRoutes = z.infer<typeof persistedServerRoutesSchema>;

const CONNECT_MACHINE_HEADER = "x-bb-connect-machine";

export interface ServerRouteTarget {
  url: string;
  headers: Record<string, string>;
  route: HostDaemonSessionRoute | null;
}

export interface ConnectGateTarget {
  serverUrl: string;
  machineCredential: string;
}

type RouteFetch = (input: URL, init: RequestInit) => Promise<Response>;

interface Candidate extends ServerRouteTarget {
  key: string;
}

export interface ServerRouteResolverOptions {
  anchorUrl: string;
  anchorHeaders: Record<string, string>;
  persisted: PersistedServerRoutes | null;
  persist?: (routes: PersistedServerRoutes) => Promise<void>;
  logger: HostDaemonLogger;
  fetchFn?: RouteFetch;
}

export function sameServerRoute(
  left: HostDaemonSessionRoute | null,
  right: HostDaemonSessionRoute | null,
): boolean {
  return left?.providerId === right?.providerId && left?.kind === right?.kind;
}

export class ServerRouteResolver {
  private readonly anchor: Candidate;
  private readonly fetchFn: RouteFetch;
  private serverId: string | null;
  private learned: HostDaemonServerRoutes["routes"];
  private activeKey: string;
  private persistence: Promise<void> = Promise.resolve();

  constructor(private readonly options: ServerRouteResolverOptions) {
    this.anchor = {
      key: serverRouteKey(options.anchorUrl),
      url: options.anchorUrl,
      headers: options.anchorHeaders,
      route: null,
    };
    const persisted =
      options.persisted !== null &&
      serverRouteKey(options.persisted.anchorUrl) === this.anchor.key
        ? options.persisted
        : null;
    this.serverId = persisted?.serverId ?? null;
    this.learned = persisted?.routes ?? [];
    this.activeKey = this.anchor.key;
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
  }

  get anchorUrl(): string {
    return this.anchor.url;
  }

  get anchorHeaders(): Record<string, string> {
    return this.anchor.headers;
  }

  candidates(): ServerRouteTarget[] {
    return this.rankedCandidates().map(({ url, headers, route }) => ({
      url,
      headers,
      route,
    }));
  }

  active(): ServerRouteTarget {
    const candidates = this.rankedCandidates();
    const active =
      candidates.find((candidate) => candidate.key === this.activeKey) ??
      this.anchor;
    return { url: active.url, headers: active.headers, route: active.route };
  }

  async select(): Promise<ServerRouteTarget> {
    const candidates = this.rankedCandidates();
    if (candidates.length === 1) {
      this.setActive(candidates[0] ?? this.anchor);
      return this.active();
    }
    const winner = await selectServerRoute(candidates, (candidate, signal) =>
      this.probe(candidate, signal),
    );
    if (winner === null) {
      this.options.logger.info(
        { routes: candidates.map((candidate) => candidate.url) },
        "No server route answered; retrying the current route",
      );
    } else {
      this.setActive(winner);
    }
    return this.active();
  }

  learn(serverRoutes: HostDaemonServerRoutes): void {
    if (this.serverId !== null && this.serverId !== serverRoutes.serverId) {
      this.options.logger.warn(
        { previousServerId: this.serverId, serverId: serverRoutes.serverId },
        "The server reported a different server id; replacing learned routes",
      );
    }
    const routesChanged =
      JSON.stringify(this.learned) !== JSON.stringify(serverRoutes.routes);
    const serverIdChanged = this.serverId !== serverRoutes.serverId;
    this.serverId = serverRoutes.serverId;
    this.learned = serverRoutes.routes;
    if (!routesChanged && !(serverIdChanged && this.learned.length > 0)) {
      return;
    }
    this.options.logger.info(
      {
        serverId: serverRoutes.serverId,
        routes: serverRoutes.routes.map((route) => ({
          providerId: route.providerId,
          kind: route.kind,
          url: route.url,
        })),
      },
      "Learned server routes",
    );
    this.persistLearned(serverRoutes.serverId);
  }

  guardedDownloadTarget(): ServerRouteTarget | null {
    const active = this.active();
    if (usesSecureInternalFetchTransport(active.url)) {
      return active;
    }
    const encrypted = this.rankedCandidates().find((candidate) =>
      usesSecureInternalFetchTransport(candidate.url),
    );
    if (encrypted !== undefined) {
      return {
        url: encrypted.url,
        headers: encrypted.headers,
        route: encrypted.route,
      };
    }
    return active.route?.kind === "local-network" ? active : null;
  }

  connectGate(): ConnectGateTarget | null {
    for (const route of this.learned) {
      const credential = route.headers[CONNECT_MACHINE_HEADER]?.trim();
      if (route.kind === "relay" && credential) {
        return { serverUrl: route.url, machineCredential: credential };
      }
    }
    const anchorCredential =
      this.anchor.headers[CONNECT_MACHINE_HEADER]?.trim();
    return anchorCredential
      ? { serverUrl: this.anchor.url, machineCredential: anchorCredential }
      : null;
  }

  flushPersistence(): Promise<void> {
    return this.persistence;
  }

  private rankedCandidates(): Candidate[] {
    return orderServerRoutes(
      this.learned.map((route) => ({
        key: serverRouteKey(route.url),
        url: route.url,
        headers: route.headers,
        route: { providerId: route.providerId, kind: route.kind },
      })),
      [this.anchor],
    );
  }

  private setActive(candidate: Candidate): void {
    if (candidate.key === this.activeKey) return;
    const previous = this.active();
    this.activeKey = candidate.key;
    this.options.logger.info(
      {
        from: previous.url,
        to: candidate.url,
        providerId: candidate.route?.providerId ?? null,
        kind: candidate.route?.kind ?? null,
      },
      "Using server route",
    );
  }

  private async probe(
    candidate: Candidate,
    signal: AbortSignal,
  ): Promise<boolean> {
    const result = await probeServerRoute({
      url: candidate.url,
      headers: candidate.headers,
      expectedServerId: this.serverId,
      fetchFn: this.fetchFn,
      signal,
    });
    if (result.kind === "different-server") {
      this.options.logger.warn(
        {
          url: candidate.url,
          expectedServerId: this.serverId,
          serverId: result.serverId,
        },
        "Ignoring a server route that answers as a different server",
      );
    }
    return result.kind === "answered";
  }

  private persistLearned(serverId: string): void {
    const persist = this.options.persist;
    if (persist === undefined) return;
    const snapshot: PersistedServerRoutes = {
      anchorUrl: this.anchor.url,
      serverId,
      routes: this.learned,
    };
    this.persistence = this.persistence
      .then(() => persist(snapshot))
      .catch((error: unknown) => {
        this.options.logger.warn(
          { ...runtimeErrorLogFields(error) },
          "Could not save learned server routes",
        );
      });
  }
}

function serverRoutesPath(dataDir: string): string {
  return join(dataDir, SERVER_ROUTES_FILE);
}

export async function readPersistedServerRoutes(
  dataDir: string,
  logger: HostDaemonLogger,
): Promise<PersistedServerRoutes | null> {
  let raw: string;
  try {
    raw = await readFile(serverRoutesPath(dataDir), "utf8");
  } catch {
    return null;
  }
  try {
    return persistedServerRoutesSchema.parse(JSON.parse(raw));
  } catch (error) {
    logger.warn(
      { ...runtimeErrorLogFields(error) },
      "Ignoring unreadable learned server routes",
    );
    return null;
  }
}

export function persistServerRoutes(
  dataDir: string,
): (routes: PersistedServerRoutes) => Promise<void> {
  return (routes) =>
    routes.routes.length === 0
      ? rm(serverRoutesPath(dataDir), { force: true })
      : writeFileAtomically({
          path: serverRoutesPath(dataDir),
          content: `${JSON.stringify(routes, null, 2)}\n`,
          mode: 0o600,
        });
}
