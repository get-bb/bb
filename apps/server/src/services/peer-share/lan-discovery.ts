import dgram from "node:dgram";
import type { ServerLogger } from "../../types.js";

/**
 * Dependency-free LAN peer discovery for "AirDrop for threads".
 *
 * Each discoverable instance periodically UDP-broadcasts a small JSON announce
 * packet on a fixed port; every instance listens on that port and remembers the
 * peers it hears from (expiring stale ones). This stays on the local link
 * (limited broadcast 255.255.255.255), needs no external dependency or mDNS
 * daemon, and uses SO_REUSEADDR so two instances on one host can both bind for
 * local testing. It is best-effort: if the socket fails to bind, discovery is
 * simply empty and the user can still send to a manually entered address.
 */

const DISCOVERY_PORT = 38891;
const BROADCAST_ADDRESS = "255.255.255.255";
const ANNOUNCE_INTERVAL_MS = 3_000;
const PEER_TTL_MS = 12_000;
const PACKET_MARKER = "bb-peer-share/1";

interface DiscoveredPeer {
  instanceId: string;
  displayName: string;
  address: string;
  port: number;
  lastSeen: number;
}

export interface NearbyPeer {
  instanceId: string;
  displayName: string;
  address: string;
  port: number;
}

interface AnnouncePayload {
  marker: typeof PACKET_MARKER;
  instanceId: string;
  displayName: string;
  /** The instance's HTTP API port, where the recipient receives offers. */
  port: number;
}

export interface LanDiscoveryArgs {
  instanceId: string;
  logger: ServerLogger;
  /**
   * Returns the current announce details when the instance is discoverable, or
   * null to stay silent. Read fresh each tick so toggling discoverability or
   * renaming takes effect without restarting discovery.
   */
  getAnnounce: () => { displayName: string; apiPort: number } | null;
  /** Monotonic clock; injected for tests. Defaults to Date.now. */
  now?: () => number;
}

export class LanDiscovery {
  private readonly instanceId: string;
  private readonly logger: ServerLogger;
  private readonly getAnnounce: LanDiscoveryArgs["getAnnounce"];
  private readonly now: () => number;
  private readonly peers = new Map<string, DiscoveredPeer>();
  private socket: dgram.Socket | null = null;
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(args: LanDiscoveryArgs) {
    this.instanceId = args.instanceId;
    this.logger = args.logger;
    this.getAnnounce = args.getAnnounce;
    this.now = args.now ?? Date.now;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.socket = socket;
    socket.on("message", (message, rinfo) => {
      this.handleMessage(message, rinfo.address);
    });
    socket.on("error", (error) => {
      this.logger.warn({ err: error }, "Peer-share discovery socket error");
      this.stop();
    });
    socket.bind(DISCOVERY_PORT, () => {
      try {
        socket.setBroadcast(true);
      } catch (error) {
        this.logger.warn(
          { err: error },
          "Peer-share discovery could not enable broadcast",
        );
      }
    });
    this.announceTimer = setInterval(() => this.announce(), ANNOUNCE_INTERVAL_MS);
    this.announceTimer.unref?.();
  }

  stop(): void {
    this.started = false;
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // already closed
      }
      this.socket = null;
    }
  }

  /** Active (non-expired) peers, excluding self. */
  listPeers(): NearbyPeer[] {
    const cutoff = this.now() - PEER_TTL_MS;
    const result: NearbyPeer[] = [];
    for (const peer of this.peers.values()) {
      if (peer.lastSeen < cutoff || peer.instanceId === this.instanceId) {
        continue;
      }
      result.push({
        instanceId: peer.instanceId,
        displayName: peer.displayName,
        address: peer.address,
        port: peer.port,
      });
    }
    return result.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  private announce(): void {
    const announce = this.getAnnounce();
    if (announce === null || this.socket === null) {
      return;
    }
    const payload: AnnouncePayload = {
      marker: PACKET_MARKER,
      instanceId: this.instanceId,
      displayName: announce.displayName,
      port: announce.apiPort,
    };
    const buffer = Buffer.from(JSON.stringify(payload));
    this.socket.send(buffer, DISCOVERY_PORT, BROADCAST_ADDRESS, (error) => {
      if (error) {
        this.logger.debug({ err: error }, "Peer-share announce failed");
      }
    });
  }

  private handleMessage(message: Buffer, address: string): void {
    let payload: AnnouncePayload;
    try {
      const parsed: unknown = JSON.parse(message.toString("utf8"));
      if (!isAnnouncePayload(parsed)) {
        return;
      }
      payload = parsed;
    } catch {
      return;
    }
    if (payload.instanceId === this.instanceId) {
      return;
    }
    this.peers.set(payload.instanceId, {
      instanceId: payload.instanceId,
      displayName: payload.displayName,
      address,
      port: payload.port,
      lastSeen: this.now(),
    });
  }
}

function isAnnouncePayload(value: unknown): value is AnnouncePayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.marker === PACKET_MARKER &&
    typeof candidate.instanceId === "string" &&
    typeof candidate.displayName === "string" &&
    typeof candidate.port === "number"
  );
}
