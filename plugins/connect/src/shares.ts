// Host-scoped port-share registry for bb connect. Hydration restores only
// persisted state; host and tunnel identity RPCs happen lazily per listing.
import { z } from "zod";
import type {
  PluginHosts,
  PluginKvStorage,
  PluginLogger,
} from "@get-bb/plugin-sdk";
import {
  ShareHostNotFoundError,
  type ShareHost,
  type ShareHostResolver,
} from "./hosts.js";
import {
  connectPublicProtocol,
  deriveConnectBaseUrl,
  type ConnectCredential,
} from "@bb/connect-client";

export const SHARES_KV_KEY = "shares";

export interface ShareListing {
  hostId: string;
  hostName: string;
  port: number;
  createdAt: number;
  /** Empty only when unavailableReason explains why no public URL exists. */
  url: string;
  unavailableReason?: string;
}

const persistedShareSchema = z
  .object({
    hostId: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65535),
    createdAt: z.number(),
  })
  .strict();
// Validate only the container here. Each unknown value is parsed independently
// below so one corrupt persisted share cannot invalidate its siblings.
const sharesContainerSchema = z.record(z.string(), z.unknown());

interface RestoredShare {
  /** Null means a legacy entry whose omitted hostId denotes the server host;
   * normalized to the real server host id once activation resolves it. */
  hostId: string | null;
  port: number;
  createdAt: number;
}

export interface ShareRemoval {
  removed: boolean;
  hostId: string;
  hostName: string;
}

export class SharePortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharePortError";
  }
}

/** Integer port in 1–65535, or throw SharePortError. */
export function parseSharePort(raw: unknown): number {
  const asNumber =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : Number.NaN;
  if (!Number.isInteger(asNumber) || asNumber < 1 || asNumber > 65535) {
    throw new SharePortError(
      `Invalid port "${String(raw)}": must be an integer between 1 and 65535`,
    );
  }
  return asNumber;
}

/** Public URL for a share on the server host's existing tunnel. */
export function sharePublicUrl(
  credential: Pick<ConnectCredential, "serverUrl" | "handle">,
  port: number,
): string {
  const base = deriveConnectBaseUrl(credential.serverUrl);
  const url = new URL(base);
  return `${url.protocol}//${credential.handle}--${port}.${url.host}`;
}

/** Public URL for a daemon-owned machine tunnel identity. */
export function machineSharePublicUrl(
  identity: { label: string; baseDomain: string },
  port: number,
): string {
  return `${connectPublicProtocol(identity.baseDomain)}//${identity.label}--${port}.${identity.baseDomain}`;
}

export function shareLoopbackOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function shareLoopbackHost(port: number): string {
  return `127.0.0.1:${port}`;
}

export function serverOwnPort(loopbackBaseUrl: string): number {
  const url = new URL(loopbackBaseUrl);
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

export interface ShareRegistryOptions {
  kv: Pick<PluginKvStorage, "get" | "set" | "delete">;
  hosts: Pick<PluginHosts, "declareSharedPorts" | "ensureSharedPortTunnel">;
  hostResolver: ShareHostResolver;
  getLoopbackBaseUrl: () => string;
  getCredential: () => ConnectCredential | null;
  log: Pick<PluginLogger, "warn">;
  onChange?: () => void;
}

function shareKey(hostId: string, port: number): string {
  return `${hostId}:${port}`;
}

function restoredShareKey(hostId: string | null, port: number): string {
  return hostId === null ? `legacy-server:${port}` : shareKey(hostId, port);
}

/** Listing hostId for a legacy share before the real server host id is known.
 * remove() round-trips it, so it can never strand a share un-removable. */
const UNRESOLVED_SERVER_HOST_ID = "server";

function compareListings(a: ShareListing, b: ShareListing): number {
  return (
    a.hostName.localeCompare(b.hostName) ||
    a.hostId.localeCompare(b.hostId) ||
    a.port - b.port
  );
}

function sharedPortErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if (
    "body" in error &&
    typeof error.body === "object" &&
    error.body !== null &&
    "code" in error.body &&
    typeof error.body.code === "string"
  ) {
    return error.body.code;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ShareRegistry {
  private shares = new Map<string, RestoredShare>();
  private loaded = false;
  private loading: Promise<void> | null = null;
  private serverHostId: string | null = null;
  /** Latest resolved listings, replaced wholesale; snapshot() reads it. */
  private lastListings: ShareListing[] = [];
  private readonly declaredMachineHostIds = new Set<string>();

  constructor(private readonly options: ShareRegistryOptions) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    this.loading = this.loadOnce();
    try {
      await this.loading;
      this.loaded = true;
    } finally {
      this.loading = null;
    }
  }

  /** Restore only validated local state. No host or tunnel RPC belongs here. */
  private async loadOnce(): Promise<void> {
    const raw = await this.options.kv.get<unknown>(SHARES_KV_KEY);
    const next = new Map<string, RestoredShare>();
    if (raw === undefined) {
      this.shares = next;
      return;
    }
    const record = sharesContainerSchema.safeParse(raw);
    if (!record.success) {
      this.options.log.warn("ignoring malformed shared-port registry");
      this.shares = next;
      return;
    }
    for (const [storageKey, rawEntry] of Object.entries(record.data)) {
      try {
        const parsed = persistedShareSchema.safeParse(rawEntry);
        if (!parsed.success) {
          this.options.log.warn(
            `skipping malformed shared-port entry "${storageKey}": ${z.prettifyError(parsed.error)}`,
          );
          continue;
        }
        const hostId = parsed.data.hostId ?? null;
        const share: RestoredShare = {
          hostId,
          port: parsed.data.port,
          createdAt: parsed.data.createdAt,
        };
        next.set(restoredShareKey(hostId, share.port), share);
      } catch (error) {
        this.options.log.warn(
          `skipping shared-port entry "${storageKey}" after an unexpected hydration error: ${errorMessage(error)}`,
        );
      }
    }
    this.shares = next;
    // Seed the sync snapshot so restored shares are visible in status and
    // realtime immediately — including unpaired, where no resolution runs.
    this.lastListings = [...next.values()]
      .map((share) => this.seededListing(share))
      .sort(compareListings);
  }

  /** Pre-resolution listing built from persisted state alone (no RPCs). */
  private seededListing(share: RestoredShare): ShareListing {
    return {
      hostId: share.hostId ?? this.serverHostId ?? UNRESOLVED_SERVER_HOST_ID,
      hostName: share.hostId ?? "server host",
      port: share.port,
      createdAt: share.createdAt,
      url: "",
      unavailableReason: "Share URL has not been resolved yet.",
    };
  }

  hasServerPort(port: number): boolean {
    for (const share of this.shares.values()) {
      if (share.port !== port) continue;
      if (share.hostId === null || share.hostId === this.serverHostId) {
        return true;
      }
    }
    return false;
  }

  /** Resolve each share independently; one unavailable host never rejects. */
  async list(hostId?: string): Promise<ShareListing[]> {
    await this.load();
    const listings = await Promise.all(
      [...this.shares.values()].map((share) => this.resolveListing(share)),
    );
    listings.sort(compareListings);
    this.lastListings = listings;
    return hostId === undefined
      ? listings
      : listings.filter((share) => share.hostId === hostId);
  }

  /** Synchronous cached view for realtime/status paths that cannot await.
   * Refreshed wholesale by list() and incrementally by add()/remove(). */
  snapshot(): ShareListing[] {
    return this.lastListings;
  }

  async add(port: number, host: ShareHost): Promise<ShareListing> {
    await this.load();
    const validated = parseSharePort(port);
    if (
      host.isServer &&
      validated === serverOwnPort(this.options.getLoopbackBaseUrl())
    ) {
      throw new SharePortError(
        `Cannot share port ${validated}: that is the bb server's own port — the bare handle URL already serves bb`,
      );
    }
    const credential = this.options.getCredential();
    if (credential === null) {
      throw new SharePortError(
        "this bb is not connected to getbb.app — run `bb connect` for how to pair",
      );
    }
    if (host.isServer) this.serverHostId = host.id;
    const existing = [...this.shares.values()].find(
      (share) =>
        share.port === validated &&
        (share.hostId === host.id || (share.hostId === null && host.isServer)),
    );
    if (existing) {
      const listing = await this.resolveListing(existing, host);
      this.updateSnapshot(listing, existing.hostId === null);
      return listing;
    }

    const url = await this.urlFor(host, validated);
    const key = shareKey(host.id, validated);
    const share: RestoredShare = {
      hostId: host.id,
      port: validated,
      createdAt: Date.now(),
    };
    this.shares.set(key, share);
    try {
      if (!host.isServer) this.declare(host.id);
      await this.persist();
    } catch (error) {
      this.shares.delete(key);
      if (!host.isServer) this.restoreDeclaration(host.id);
      throw error;
    }
    const listing: ShareListing = {
      hostId: host.id,
      hostName: host.name,
      port: validated,
      createdAt: share.createdAt,
      url,
    };
    this.updateSnapshot(listing, false);
    this.options.onChange?.();
    return listing;
  }

  async remove(port: number, hostSelector: string): Promise<ShareRemoval> {
    await this.load();
    const validated = parseSharePort(port);
    const selector = hostSelector.trim();
    if (selector.length === 0) {
      throw new SharePortError("--host requires a name or id");
    }
    const resolved = await this.findForRemoval(validated, selector);
    if (!resolved) {
      return { removed: false, hostId: selector, hostName: selector };
    }
    const { key, share } = resolved;
    let host: ShareHost | undefined;
    try {
      host = await this.resolveHost(share);
    } catch {
      // A deleted host must remain prunable by its durable id.
    }
    const publicHostId = host?.id ?? share.hostId ?? selector;
    const hostName = host?.name ?? "removed host";
    this.shares.delete(key);
    try {
      await this.persist();
    } catch (error) {
      this.shares.set(key, share);
      throw error;
    }
    const declarationHostId =
      host?.isServer === false
        ? host.id
        : host === undefined && share.hostId !== null
          ? share.hostId
          : undefined;
    // Removal is local durable state first. A daemon declaration failure must
    // never resurrect a share; activation/reconnect will reconcile the latest
    // desired set, and the server always accepts an empty clearing declaration.
    if (declarationHostId !== undefined) {
      try {
        this.declare(declarationHostId);
      } catch (error) {
        this.options.log.warn(
          `failed to update shared ports after removing port ${validated} from host ${declarationHostId}: ${errorMessage(error)}`,
        );
      }
    }
    const removedListingIds = this.snapshotAliases(
      publicHostId,
      share.hostId === null,
    );
    this.lastListings = this.lastListings.filter(
      (entry) =>
        !(entry.port === validated && removedListingIds.has(entry.hostId)),
    );
    this.options.onChange?.();
    return { removed: true, hostId: publicHostId, hostName };
  }

  /** Explicitly empty every declaration this registry successfully made. */
  clearMachineDeclarations(): void {
    for (const hostId of this.declaredMachineHostIds) {
      try {
        this.options.hosts.declareSharedPorts(hostId, []);
      } catch (error) {
        this.options.log.warn(
          `failed to clear shared ports for host ${hostId}: ${errorMessage(error)}`,
        );
      }
    }
    this.declaredMachineHostIds.clear();
  }

  /** Restore daemon declarations after service start or re-pairing. */
  async declareMachineShares(
    isActivationCurrent: () => boolean,
  ): Promise<void> {
    if (!isActivationCurrent() || this.options.getCredential() === null) return;
    const serverHostId = await this.options.hostResolver.serverHostId();
    if (!isActivationCurrent()) return;
    this.serverHostId = serverHostId;
    await this.normalizeLegacyShares(serverHostId);
    let firstError: unknown;
    for (const hostId of this.machineHostIds()) {
      if (!isActivationCurrent()) return;
      try {
        this.declare(hostId);
      } catch (error) {
        firstError ??= error;
        this.options.log.warn(
          `failed to declare shared ports for host ${hostId}: ${errorMessage(error)}`,
        );
      }
    }
    if (firstError !== undefined) throw firstError;
  }

  /** Rewrite legacy hostId-less entries to the resolved server host id. */
  private async normalizeLegacyShares(serverHostId: string): Promise<void> {
    let changed = false;
    for (const [key, share] of [...this.shares]) {
      if (share.hostId !== null) continue;
      this.shares.delete(key);
      const canonicalKey = shareKey(serverHostId, share.port);
      if (!this.shares.has(canonicalKey)) {
        this.shares.set(canonicalKey, { ...share, hostId: serverHostId });
      }
      changed = true;
    }
    if (!changed) return;
    try {
      await this.persist();
    } catch (error) {
      // In-memory state is already normalized; the next successful persist
      // (any add/remove, or the next activation) rewrites the stored map.
      this.options.log.warn(
        `failed to persist normalized legacy shares: ${errorMessage(error)}`,
      );
    }
  }

  /**
   * All snapshot hostIds this share may currently be listed under. A legacy
   * or server-host share may have a pre-resolution placeholder row, so every
   * snapshot mutation must clear the aliases, not just the concrete id.
   */
  private snapshotAliases(hostId: string, wasLegacy: boolean): Set<string> {
    const aliases = new Set([hostId]);
    if (wasLegacy || hostId === this.serverHostId) {
      aliases.add(UNRESOLVED_SERVER_HOST_ID);
      if (this.serverHostId !== null) aliases.add(this.serverHostId);
    }
    return aliases;
  }

  private updateSnapshot(listing: ShareListing, wasLegacy: boolean): void {
    const aliases = this.snapshotAliases(listing.hostId, wasLegacy);
    const next = this.lastListings.filter(
      (entry) => !(entry.port === listing.port && aliases.has(entry.hostId)),
    );
    next.push(listing);
    next.sort(compareListings);
    this.lastListings = next;
  }

  private async resolveListing(
    share: RestoredShare,
    knownHost?: ShareHost,
  ): Promise<ShareListing> {
    let host = knownHost;
    try {
      host ??= await this.resolveHost(share);
      if (host.isServer) this.serverHostId = host.id;
      return {
        hostId: host.id,
        hostName: host.name,
        port: share.port,
        createdAt: share.createdAt,
        url: await this.urlFor(host, share.port),
      };
    } catch (error) {
      return this.unavailableListing(share, error, host);
    }
  }

  private async resolveHost(share: RestoredShare): Promise<ShareHost> {
    return share.hostId === null
      ? this.options.hostResolver.serverHost()
      : this.options.hostResolver.byId(share.hostId);
  }

  /** `host` is set when resolution succeeded and only the URL failed. */
  private unavailableListing(
    share: RestoredShare,
    error: unknown,
    host?: ShareHost,
  ): ShareListing {
    return {
      hostId:
        host?.id ??
        share.hostId ??
        this.serverHostId ??
        UNRESOLVED_SERVER_HOST_ID,
      hostName:
        host?.name ??
        (error instanceof ShareHostNotFoundError
          ? "removed host"
          : (share.hostId ?? "server host")),
      port: share.port,
      createdAt: share.createdAt,
      url: "",
      unavailableReason: this.unavailableReason(share, error),
    };
  }

  private unavailableReason(share: RestoredShare, error: unknown): string {
    if (error instanceof ShareHostNotFoundError) {
      return `Host ${error.hostId} was removed. Run \`bb connect unexpose ${share.port} --host ${error.hostId}\` to prune this share.`;
    }
    return error instanceof SharePortError
      ? error.message
      : `Share URL unavailable: ${errorMessage(error)}`;
  }

  private async urlFor(host: ShareHost, port: number): Promise<string> {
    if (host.isServer) return this.serverUrl(port);
    try {
      const identity = await this.options.hosts.ensureSharedPortTunnel(host.id);
      return machineSharePublicUrl(identity, port);
    } catch (error) {
      const prefix = `Cannot share port ${port} from host "${host.name}" (${host.id})`;
      const code = sharedPortErrorCode(error);
      if (code === "connect_host_unenrolled") {
        throw new SharePortError(
          `${prefix}: this host has no bb connect machine credential. Enroll it via Connect in Settings > Machines.`,
        );
      }
      if (code === "connect_host_offline" || code === "host_unavailable") {
        throw new SharePortError(
          `${prefix}: this host is not connected right now. Bring the host online and try again.`,
        );
      }
      throw new SharePortError(`${prefix}: ${errorMessage(error)}`);
    }
  }

  private serverUrl(port: number): string {
    const credential = this.options.getCredential();
    return credential
      ? sharePublicUrl(credential, port)
      : `http://127.0.0.1:${port}`;
  }

  private machineHostIds(): string[] {
    return [
      ...new Set(
        [...this.shares.values()]
          .map((share) => share.hostId)
          .filter(
            (hostId): hostId is string =>
              hostId !== null && hostId !== this.serverHostId,
          ),
      ),
    ];
  }

  private async findForRemoval(
    port: number,
    selector: string,
  ): Promise<{ key: string; share: RestoredShare } | undefined> {
    for (const [key, share] of this.shares) {
      if (share.port !== port) continue;
      if (share.hostId === selector) return { key, share };
      // Round-trip the ids a legacy share may have been listed under before
      // its host resolved, so a placeholder can never strand a share.
      if (
        share.hostId === null &&
        (selector === this.serverHostId ||
          selector === UNRESOLVED_SERVER_HOST_ID)
      ) {
        return { key, share };
      }
    }
    const matches: Array<{ key: string; share: RestoredShare }> = [];
    for (const [key, share] of this.shares) {
      if (share.port !== port) continue;
      try {
        const host = await this.resolveHost(share);
        if (
          host.id === selector ||
          host.name.toLocaleLowerCase() === selector.toLocaleLowerCase()
        ) {
          matches.push({ key, share });
        }
      } catch {
        // An unavailable host remains removable by exact durable id above.
      }
    }
    if (matches.length > 1) {
      throw new SharePortError(
        `host name "${selector}" is ambiguous; pass a host id`,
      );
    }
    return matches[0];
  }

  private declare(hostId: string): void {
    const ports = [...this.shares.values()]
      .filter((share) => share.hostId === hostId)
      .map((share) => share.port)
      .sort((a, b) => a - b);
    this.options.hosts.declareSharedPorts(hostId, ports);
    if (ports.length === 0) {
      this.declaredMachineHostIds.delete(hostId);
    } else {
      this.declaredMachineHostIds.add(hostId);
    }
  }

  private restoreDeclaration(hostId: string): void {
    try {
      this.declare(hostId);
    } catch (error) {
      this.options.log.warn(
        `failed to restore shared ports for host ${hostId}: ${errorMessage(error)}`,
      );
    }
  }

  private async persist(): Promise<void> {
    if (this.shares.size === 0) {
      await this.options.kv.delete(SHARES_KV_KEY);
      return;
    }
    const map: Record<string, unknown> = {};
    for (const share of this.shares.values()) {
      const storageKey =
        share.hostId === null
          ? String(share.port)
          : shareKey(share.hostId, share.port);
      map[storageKey] = {
        ...(share.hostId === null ? {} : { hostId: share.hostId }),
        port: share.port,
        createdAt: share.createdAt,
      };
    }
    await this.options.kv.set(SHARES_KV_KEY, map);
  }

  get isLoaded(): boolean {
    return this.loaded;
  }
}
