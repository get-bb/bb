import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  createThread,
  getThread,
  importThreadEvents,
  listEvents,
  type DbConnection,
} from "@bb/db";
import type {
  PeerShareBundle,
  PeerShareIdentity,
  PeerShareIncoming,
  PeerShareNearbyPeer,
} from "@bb/server-contract";
import type { NotificationHub } from "../../ws/hub.js";
import type { ServerLogger } from "../../types.js";
import { LanDiscovery } from "./lan-discovery.js";

interface PersistedIdentity {
  instanceId: string;
  displayName: string;
  discoverable: boolean;
}

interface IncomingShare {
  id: string;
  senderName: string;
  threadTitle: string;
  bundle: PeerShareBundle;
  createdAt: number;
}

export interface PeerShareServiceArgs {
  db: DbConnection;
  hub: NotificationHub;
  logger: ServerLogger;
  dataDir: string;
  apiPort: number;
  /** True when the HTTP server is bound to a LAN interface (BB_LAN_SHARE). */
  lanReachable: boolean;
}

/**
 * "AirDrop for threads": owns the instance's renameable identity + discoverable
 * flag (persisted next to the db), drives LAN discovery, sends a thread's
 * read-only snapshot to a peer, and holds incoming offers until the recipient
 * accepts (import) or declines. Identity and incoming offers are intentionally
 * lightweight in-memory/JSON state — no new DB table — and the imported thread
 * reuses the existing threads/events tables.
 */
export class PeerShareService {
  private readonly db: DbConnection;
  private readonly hub: NotificationHub;
  private readonly logger: ServerLogger;
  private readonly apiPort: number;
  private readonly lanReachable: boolean;
  private readonly identityPath: string;
  private identity: PersistedIdentity;
  private readonly discovery: LanDiscovery;
  private readonly incoming = new Map<string, IncomingShare>();

  constructor(args: PeerShareServiceArgs) {
    this.db = args.db;
    this.hub = args.hub;
    this.logger = args.logger;
    this.apiPort = args.apiPort;
    this.lanReachable = args.lanReachable;
    this.identityPath = join(args.dataDir, "peer-share.json");
    this.identity = this.loadIdentity();
    this.discovery = new LanDiscovery({
      instanceId: this.identity.instanceId,
      logger: args.logger,
      getAnnounce: () =>
        this.identity.discoverable
          ? { displayName: this.identity.displayName, apiPort: this.apiPort }
          : null,
    });
  }

  start(): void {
    this.discovery.start();
  }

  stop(): void {
    this.discovery.stop();
  }

  getIdentity(): PeerShareIdentity {
    return {
      instanceId: this.identity.instanceId,
      displayName: this.identity.displayName,
      discoverable: this.identity.discoverable,
      lanReachable: this.lanReachable,
    };
  }

  setIdentity(update: {
    displayName?: string;
    discoverable?: boolean;
  }): PeerShareIdentity {
    this.identity = {
      ...this.identity,
      ...(update.displayName !== undefined
        ? { displayName: update.displayName.trim() || this.identity.displayName }
        : {}),
      ...(update.discoverable !== undefined
        ? { discoverable: update.discoverable }
        : {}),
    };
    this.saveIdentity();
    return this.getIdentity();
  }

  listPeers(): PeerShareNearbyPeer[] {
    return this.discovery.listPeers();
  }

  /** Build the portable read-only snapshot of a thread. Throws if missing. */
  serializeThread(threadId: string): PeerShareBundle {
    const thread = getThread(this.db, threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }
    const eventRows = listEvents(this.db, { threadId });
    return {
      version: 1,
      thread: {
        title: thread.title,
        titleFallback: thread.titleFallback,
        providerId: thread.providerId,
        createdAt: thread.createdAt,
      },
      events: eventRows.map((row) => ({
        sequence: row.sequence,
        scopeKind: row.scopeKind,
        turnId: row.turnId,
        providerThreadId: row.providerThreadId,
        type: row.type,
        itemId: row.itemId,
        itemKind: row.itemKind,
        data: row.data,
        createdAt: row.createdAt,
      })),
    };
  }

  /** Serialize the thread and POST it to a peer's offer endpoint. */
  async sendThread(args: {
    threadId: string;
    address: string;
    port: number;
  }): Promise<void> {
    const bundle = this.serializeThread(args.threadId);
    const url = `http://${args.address}:${args.port}/api/v1/peer-share/offer`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        senderName: this.identity.displayName,
        bundle,
      }),
    });
    if (!response.ok) {
      throw new Error(`Peer responded with ${response.status}`);
    }
  }

  /** Store an inbound offer and notify the app so it can surface a prompt. */
  receiveOffer(args: { senderName: string; bundle: PeerShareBundle }): void {
    const id = `pshare_${randomUUID()}`;
    const threadTitle =
      args.bundle.thread.title?.trim() ||
      args.bundle.thread.titleFallback?.trim() ||
      "Shared thread";
    this.incoming.set(id, {
      id,
      senderName: args.senderName,
      threadTitle,
      bundle: args.bundle,
      createdAt: Date.now(),
    });
    this.hub.notifySystem(["config-changed"]);
  }

  listIncoming(): PeerShareIncoming[] {
    return Array.from(this.incoming.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((share) => ({
        id: share.id,
        senderName: share.senderName,
        threadTitle: share.threadTitle,
        eventCount: share.bundle.events.length,
        createdAt: share.createdAt,
      }));
  }

  /** Import an accepted offer as a new read-only thread; returns its ids. */
  acceptIncoming(id: string): { threadId: string; projectId: string } {
    const share = this.incoming.get(id);
    if (!share) {
      throw new Error(`Incoming share ${id} not found`);
    }
    const title = share.bundle.thread.title;
    const thread = createThread(this.db, this.hub, {
      projectId: PERSONAL_PROJECT_ID,
      environmentId: null,
      providerId: share.bundle.thread.providerId,
      title: title ? `${title} (shared)` : "Shared thread",
      titleFallback: share.bundle.thread.titleFallback,
      status: "idle",
    });
    importThreadEvents(this.db, this.hub, {
      threadId: thread.id,
      events: share.bundle.events,
    });
    this.incoming.delete(id);
    this.hub.notifySystem(["config-changed"]);
    return { threadId: thread.id, projectId: thread.projectId };
  }

  declineIncoming(id: string): void {
    if (this.incoming.delete(id)) {
      this.hub.notifySystem(["config-changed"]);
    }
  }

  private loadIdentity(): PersistedIdentity {
    try {
      if (existsSync(this.identityPath)) {
        const parsed: unknown = JSON.parse(
          readFileSync(this.identityPath, "utf8"),
        );
        if (isPersistedIdentity(parsed)) {
          return parsed;
        }
      }
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to read peer-share identity");
    }
    const identity: PersistedIdentity = {
      instanceId: randomUUID(),
      displayName: hostname() || "bb",
      discoverable: false,
    };
    this.identity = identity;
    this.saveIdentity();
    return identity;
  }

  private saveIdentity(): void {
    try {
      writeFileSync(this.identityPath, JSON.stringify(this.identity, null, 2));
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to persist peer-share identity");
    }
  }
}

function isPersistedIdentity(value: unknown): value is PersistedIdentity {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.instanceId === "string" &&
    typeof candidate.displayName === "string" &&
    typeof candidate.discoverable === "boolean"
  );
}
