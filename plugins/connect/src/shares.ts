// Host-scoped port-share registry for bb connect. Hydration restores only
// persisted state; host and tunnel identity RPCs happen lazily per listing.
import { z } from "zod";
import type {
  PluginHosts,
  PluginKvStorage,
  PluginLogger,
} from "@bb/plugin-sdk";
import type { ConnectCredential } from "./credential.js";
import {
  ShareHostNotFoundError,
  type ShareHost,
  type ShareHostResolver,
} from "./hosts.js";
import { deriveConnectBaseUrl } from "./redeem.js";

export const SHARES_KV_KEY = "shares";

export interface Share {
  hostId: string;
  port: number;
  createdAt: number;
}

export interface ShareListing extends Share {
  hostName: string;
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
  /** Preserve legacy keys until a user mutation naturally rewrites the map. */
  storageKey: string;
  /** Null means a legacy entry whose omitted hostId denotes the server host. */
  hostId: string | null;
  port: number;
  createdAt: number;
  host?: ShareHost;
  machineUrl?: string;
  unavailableHostName?: string;
  unavailableReason?: string;
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
  const expectedHost = `${identity.label}--${port}.${identity.baseDomain}`;
  const origin = new URL(`https://${expectedHost}`);
  if (
    origin.host !== expectedHost ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new SharePortError(
      "the host returned an invalid connect tunnel identity",
    );
  }
  return origin.origin;
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
          storageKey,
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
  }

  hasServerPort(port: number): boolean {
    for (const share of this.shares.values()) {
      if (share.port !== port) continue;
      if (share.hostId === null || share.host?.isServer === true) return true;
      if (this.serverHostId !== null && share.hostId === this.serverHostId) {
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
    const filtered = listings.filter(
      (share) => hostId === undefined || share.hostId === hostId,
    );
    filtered.sort(
      (a, b) =>
        a.hostName.localeCompare(b.hostName) ||
        a.hostId.localeCompare(b.hostId) ||
        a.port - b.port,
    );
    return filtered;
  }

  /** Synchronous cached view for realtime/status paths that cannot await. */
  snapshot(): ShareListing[] {
    const listings = [...this.shares.values()].map((share) =>
      this.snapshotListing(share),
    );
    listings.sort(
      (a, b) =>
        a.hostName.localeCompare(b.hostName) ||
        a.hostId.localeCompare(b.hostId) ||
        a.port - b.port,
    );
    return listings;
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
      existing.host = host;
      return this.resolveListing(existing);
    }

    const url = await this.urlFor(host, validated);
    const key = shareKey(host.id, validated);
    const share: RestoredShare = {
      storageKey: key,
      hostId: host.id,
      host,
      port: validated,
      createdAt: Date.now(),
      ...(host.isServer ? {} : { machineUrl: url }),
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
    this.options.onChange?.();
    return {
      hostId: host.id,
      hostName: host.name,
      port: validated,
      createdAt: share.createdAt,
      url,
    };
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
    let host = share.host;
    if (!host) {
      try {
        host = await this.resolveHost(share);
      } catch {
        // A deleted host must remain prunable by its durable id.
      }
    }
    const publicHostId = host?.id ?? share.hostId ?? selector;
    const hostName = host?.name ?? "removed host";
    this.shares.delete(key);
    try {
      if (host && !host.isServer) this.declare(host.id);
      await this.persist();
    } catch (error) {
      this.shares.set(key, share);
      if (host && !host.isServer) this.restoreDeclaration(host.id);
      throw error;
    }
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
  async declareMachineShares(): Promise<void> {
    if (this.options.getCredential() === null) return;
    this.serverHostId = await this.options.hostResolver.serverHostId();
    let firstError: unknown;
    for (const hostId of this.machineHostIds()) {
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

  private async resolveListing(share: RestoredShare): Promise<ShareListing> {
    try {
      const host = await this.resolveHost(share);
      share.host = host;
      if (host.isServer) this.serverHostId = host.id;
      const url = host.isServer
        ? this.serverUrl(share.port)
        : (share.machineUrl ?? (await this.urlFor(host, share.port)));
      if (!host.isServer) share.machineUrl = url;
      share.unavailableHostName = undefined;
      share.unavailableReason = undefined;
      return {
        hostId: host.id,
        hostName: host.name,
        port: share.port,
        createdAt: share.createdAt,
        url,
      };
    } catch (error) {
      const reason = this.unavailableReason(share, error);
      share.unavailableHostName =
        error instanceof ShareHostNotFoundError ? "removed host" : undefined;
      share.unavailableReason = reason;
      return this.snapshotListing(share);
    }
  }

  private async resolveHost(share: RestoredShare): Promise<ShareHost> {
    if (share.host) return share.host;
    return share.hostId === null
      ? this.options.hostResolver.serverHost()
      : this.options.hostResolver.byId(share.hostId);
  }

  private snapshotListing(share: RestoredShare): ShareListing {
    const hostId =
      share.host?.id ?? share.hostId ?? this.serverHostId ?? "server";
    const hostName =
      share.host?.name ??
      share.unavailableHostName ??
      (share.hostId === null ? "server host" : share.hostId);
    let url = "";
    if (share.host?.isServer === true) {
      url = this.serverUrl(share.port);
    } else if (share.machineUrl !== undefined) {
      url = share.machineUrl;
    }
    const unavailableReason =
      url === ""
        ? (share.unavailableReason ?? "Share URL has not been resolved yet.")
        : undefined;
    return {
      hostId,
      hostName,
      port: share.port,
      createdAt: share.createdAt,
      url,
      ...(unavailableReason === undefined ? {} : { unavailableReason }),
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
      if (share.port === port && share.hostId === selector) {
        return { key, share };
      }
    }
    const matches: Array<{ key: string; share: RestoredShare }> = [];
    for (const [key, share] of this.shares) {
      if (share.port !== port) continue;
      try {
        const host = await this.resolveHost(share);
        share.host = host;
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
      map[share.storageKey] = {
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
