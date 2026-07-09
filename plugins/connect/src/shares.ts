// Port-share registry for bb connect. A share is a local loopback port that
// the tunnel will proxy when the relay stamps `target` on an open frame.
// Name-based shares are a later fast-follow — ports only for now.
import { z } from "zod";
import type { PluginKvStorage } from "@bb/plugin-sdk";
import type { ConnectCredential } from "./credential.js";
import { deriveConnectBaseUrl } from "./redeem.js";

export const SHARES_KV_KEY = "shares";

export interface Share {
  port: number;
  createdAt: number;
}

export interface ShareListing {
  port: number;
  url: string;
  createdAt: number;
}

const sharesMapSchema = z.record(
  z.string(),
  z.object({
    port: z.number().int().min(1).max(65535),
    createdAt: z.number(),
  }),
);

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

/**
 * Public share URL for a port: `https://<label>--<port>.<base-domain>`.
 * `credential.handle` is the paired server's routing label (subdomain),
 * which may be a non-primary label when multiple bbs are connected.
 * Base domain is derived from the credential's serverUrl the same way the
 * connect apex is (e.g. `https://sawyer.getbb.app` → `getbb.app`).
 */
export function sharePublicUrl(
  credential: Pick<ConnectCredential, "serverUrl" | "handle">,
  port: number,
): string {
  const base = deriveConnectBaseUrl(credential.serverUrl);
  const url = new URL(base);
  return `${url.protocol}//${credential.handle}--${port}.${url.host}`;
}

/** Loopback origin the tunnel proxies a share to. Always 127.0.0.1. */
export function shareLoopbackOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function shareLoopbackHost(port: number): string {
  return `127.0.0.1:${port}`;
}

/** Port the bb server itself listens on (from its loopback base URL). */
export function serverOwnPort(loopbackBaseUrl: string): number {
  const url = new URL(loopbackBaseUrl);
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

export interface ShareRegistryOptions {
  kv: Pick<PluginKvStorage, "get" | "set" | "delete">;
  getLoopbackBaseUrl: () => string;
  /** Current pairing; null when unpaired. Used to build share URLs. */
  getCredential: () => ConnectCredential | null;
  /** Fired after a successful add/remove that changed the set. */
  onChange?: () => void;
}

/**
 * Durable map of shared ports in plugin kv. Loaded at service start; a
 * dead port simply 502s/connection-refuses later rather than being GC'd.
 */
export class ShareRegistry {
  private shares = new Map<number, Share>();
  private loaded = false;

  constructor(private readonly options: ShareRegistryOptions) {}

  async load(): Promise<void> {
    const raw = await this.options.kv.get<unknown>(SHARES_KV_KEY);
    this.shares.clear();
    if (raw !== undefined) {
      const parsed = sharesMapSchema.safeParse(raw);
      if (parsed.success) {
        for (const entry of Object.values(parsed.data)) {
          this.shares.set(entry.port, {
            port: entry.port,
            createdAt: entry.createdAt,
          });
        }
      }
    }
    this.loaded = true;
  }

  has(port: number): boolean {
    return this.shares.has(port);
  }

  list(): ShareListing[] {
    const credential = this.options.getCredential();
    const listings: ShareListing[] = [];
    for (const share of this.shares.values()) {
      listings.push({
        port: share.port,
        createdAt: share.createdAt,
        url: credential
          ? sharePublicUrl(credential, share.port)
          : `http://127.0.0.1:${share.port}`,
      });
    }
    listings.sort((a, b) => a.port - b.port);
    return listings;
  }

  async add(port: number): Promise<ShareListing> {
    const validated = parseSharePort(port);
    const own = serverOwnPort(this.options.getLoopbackBaseUrl());
    if (validated === own) {
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
    const existing = this.shares.get(validated);
    if (existing) {
      return {
        port: existing.port,
        createdAt: existing.createdAt,
        url: sharePublicUrl(credential, existing.port),
      };
    }
    const share: Share = { port: validated, createdAt: Date.now() };
    this.shares.set(validated, share);
    await this.persist();
    this.options.onChange?.();
    return {
      port: share.port,
      createdAt: share.createdAt,
      url: sharePublicUrl(credential, share.port),
    };
  }

  /**
   * Remove a share. Idempotent — returns whether anything was removed.
   */
  async remove(port: number): Promise<boolean> {
    const validated = parseSharePort(port);
    const removed = this.shares.delete(validated);
    if (removed) {
      await this.persist();
      this.options.onChange?.();
    }
    return removed;
  }

  private async persist(): Promise<void> {
    if (this.shares.size === 0) {
      await this.options.kv.delete(SHARES_KV_KEY);
      return;
    }
    const map: Record<string, Share> = {};
    for (const share of this.shares.values()) {
      map[String(share.port)] = share;
    }
    await this.options.kv.set(SHARES_KV_KEY, map);
  }

  /** Test/debug: whether load() has completed. */
  get isLoaded(): boolean {
    return this.loaded;
  }
}
