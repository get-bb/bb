// Host-scoped port-share registry for bb connect. Server-host shares ride the
// plugin's existing server tunnel; machine-host shares ride the owning daemon.
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
  url: string;
}

const persistedShareSchema = z.object({
  hostId: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535),
  createdAt: z.number(),
});
const sharesMapSchema = z.record(z.string(), persistedShareSchema);

interface LoadedShare extends Share {
  hostName: string;
  url: string;
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

export class ShareRegistry {
  private shares = new Map<string, LoadedShare>();
  /** Persisted shares whose owning host was removed; retained for pruning. */
  private orphanedShares = new Map<string, Share>();
  private loaded = false;
  private loading: Promise<void> | null = null;
  private serverHostId: string | null = null;

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

  private async loadOnce(): Promise<void> {
    const serverHost = await this.options.hostResolver.serverHost();
    this.serverHostId = serverHost.id;
    const raw = await this.options.kv.get<unknown>(SHARES_KV_KEY);
    const next = new Map<string, LoadedShare>();
    const nextOrphans = new Map<string, Share>();
    if (raw !== undefined) {
      const parsed = sharesMapSchema.safeParse(raw);
      if (parsed.success) {
        for (const entry of Object.values(parsed.data)) {
          const hostId = entry.hostId ?? serverHost.id;
          let host: ShareHost;
          try {
            host =
              hostId === serverHost.id
                ? serverHost
                : await this.options.hostResolver.byId(hostId);
          } catch (error) {
            if (!(error instanceof ShareHostNotFoundError)) throw error;
            const orphan = {
              hostId,
              port: entry.port,
              createdAt: entry.createdAt,
            };
            nextOrphans.set(shareKey(hostId, entry.port), orphan);
            this.options.log.warn(
              `skipping shared port ${entry.port} for removed host ${hostId}; run \`bb connect unexpose ${entry.port} --host ${hostId}\` to prune it`,
            );
            continue;
          }
          const url = await this.urlFor(host, entry.port);
          const share = {
            hostId,
            hostName: host.name,
            port: entry.port,
            createdAt: entry.createdAt,
            url,
          };
          next.set(shareKey(hostId, entry.port), share);
        }
      }
    }
    this.shares = next;
    this.orphanedShares = nextOrphans;
  }

  hasServerPort(port: number): boolean {
    return (
      this.serverHostId !== null &&
      this.shares.has(shareKey(this.serverHostId, port))
    );
  }

  list(hostId?: string): ShareListing[] {
    const listings = [...this.shares.values()]
      .filter((share) => hostId === undefined || share.hostId === hostId)
      .map((share) => this.toListing(share));
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
    const key = shareKey(host.id, validated);
    const existing = this.shares.get(key);
    if (existing) return this.toListing(existing);
    const orphan = this.orphanedShares.get(key);

    const url = await this.urlFor(host, validated);
    const share: LoadedShare = {
      hostId: host.id,
      hostName: host.name,
      port: validated,
      createdAt: Date.now(),
      url,
    };
    this.orphanedShares.delete(key);
    this.shares.set(key, share);
    try {
      if (!host.isServer) this.declare(host.id);
      await this.persist();
    } catch (error) {
      this.shares.delete(key);
      if (orphan) this.orphanedShares.set(key, orphan);
      if (!host.isServer) this.restoreDeclaration(host.id);
      throw error;
    }
    this.options.onChange?.();
    return { ...share };
  }

  async remove(port: number, hostSelector: string): Promise<ShareRemoval> {
    await this.load();
    const validated = parseSharePort(port);
    const selector = hostSelector.trim();
    if (selector.length === 0) {
      throw new SharePortError("--host requires a name or id");
    }
    const resolved = this.findForRemoval(validated, selector);
    if (!resolved) {
      return { removed: false, hostId: selector, hostName: selector };
    }
    const { hostId, hostName, key, loaded, orphan } = resolved;
    if (loaded) this.shares.delete(key);
    if (orphan) this.orphanedShares.delete(key);
    const isServer = hostId === this.serverHostId;
    try {
      if (!isServer && loaded) this.declare(hostId);
      await this.persist();
    } catch (error) {
      if (loaded) this.shares.set(key, loaded);
      if (orphan) this.orphanedShares.set(key, orphan);
      if (!isServer && loaded) this.restoreDeclaration(hostId);
      throw error;
    }
    this.options.onChange?.();
    return { removed: true, hostId, hostName };
  }

  /** Explicitly empty every daemon declaration before plugin shutdown. */
  clearMachineDeclarations(): void {
    for (const hostId of this.machineHostIds()) {
      try {
        this.options.hosts.declareSharedPorts(hostId, []);
      } catch (error) {
        this.options.log.warn(
          `failed to clear shared ports for host ${hostId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** Restore all daemon declarations after service start or re-pairing. */
  declareMachineShares(): void {
    if (this.options.getCredential() === null) return;
    for (const hostId of this.machineHostIds()) this.declare(hostId);
  }

  private async urlFor(host: ShareHost, port: number): Promise<string> {
    if (host.isServer) {
      const credential = this.options.getCredential();
      return credential
        ? sharePublicUrl(credential, port)
        : `http://127.0.0.1:${port}`;
    }
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
      throw new SharePortError(
        `${prefix}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private machineHostIds(): string[] {
    return [
      ...new Set(
        [...this.shares.values()]
          .filter((share) => share.hostId !== this.serverHostId)
          .map((share) => share.hostId),
      ),
    ];
  }

  private findForRemoval(
    port: number,
    selector: string,
  ):
    | {
        hostId: string;
        hostName: string;
        key: string;
        loaded: LoadedShare | undefined;
        orphan: Share | undefined;
      }
    | undefined {
    const exactKey = shareKey(selector, port);
    const exactLoaded = this.shares.get(exactKey);
    if (exactLoaded) {
      return {
        hostId: exactLoaded.hostId,
        hostName: exactLoaded.hostName,
        key: exactKey,
        loaded: exactLoaded,
        orphan: undefined,
      };
    }
    const exactOrphan = this.orphanedShares.get(exactKey);
    if (exactOrphan) {
      return {
        hostId: exactOrphan.hostId,
        hostName: "removed host",
        key: exactKey,
        loaded: undefined,
        orphan: exactOrphan,
      };
    }
    const matches = [...this.shares.entries()].filter(
      ([, share]) =>
        share.port === port &&
        share.hostName.toLocaleLowerCase() === selector.toLocaleLowerCase(),
    );
    if (matches.length > 1) {
      throw new SharePortError(
        `host name "${selector}" is ambiguous; pass a host id`,
      );
    }
    const match = matches[0];
    if (!match) return undefined;
    const [key, loaded] = match;
    return {
      hostId: loaded.hostId,
      hostName: loaded.hostName,
      key,
      loaded,
      orphan: undefined,
    };
  }

  private toListing(share: LoadedShare): ShareListing {
    const credential = this.options.getCredential();
    return {
      ...share,
      url:
        share.hostId === this.serverHostId
          ? credential
            ? sharePublicUrl(credential, share.port)
            : `http://127.0.0.1:${share.port}`
          : share.url,
    };
  }

  private declare(hostId: string): void {
    const ports = this.list(hostId).map((share) => share.port);
    this.options.hosts.declareSharedPorts(hostId, ports);
  }

  private restoreDeclaration(hostId: string): void {
    try {
      this.declare(hostId);
    } catch (error) {
      this.options.log.warn(
        `failed to restore shared ports for host ${hostId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async persist(): Promise<void> {
    if (this.shares.size === 0 && this.orphanedShares.size === 0) {
      await this.options.kv.delete(SHARES_KV_KEY);
      return;
    }
    const map: Record<string, Share> = {};
    for (const share of this.shares.values()) {
      map[shareKey(share.hostId, share.port)] = {
        hostId: share.hostId,
        port: share.port,
        createdAt: share.createdAt,
      };
    }
    for (const share of this.orphanedShares.values()) {
      map[shareKey(share.hostId, share.port)] = { ...share };
    }
    await this.options.kv.set(SHARES_KV_KEY, map);
  }

  get isLoaded(): boolean {
    return this.loaded;
  }
}
