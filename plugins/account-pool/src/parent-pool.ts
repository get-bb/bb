import { z } from "zod";
import {
  poolAvailabilitySchema,
  UNAVAILABLE_POOL,
  type PoolAvailability,
} from "./contracts.js";

export const PARENT_URL_ENV = "BB_ACCOUNT_POOL_PARENT_URL";
export const PARENT_TOKEN_ENV = "BB_ACCOUNT_POOL_PARENT_TOKEN";
export const AVAILABILITY_PATH = "/availability";
export const HUB_TOKEN_HEADER = "x-bb-account-pool-token";

const DEFAULT_AVAILABILITY_TTL_MS = 30_000;
const AVAILABILITY_TIMEOUT_MS = 2_000;

const parentUrlSchema = z.string().refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "Must be an HTTP or HTTPS URL.");

const parentTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

export interface ParentPool {
  baseUrl: string;
  token: string;
}

export function readParentPool(
  env: NodeJS.ProcessEnv = process.env,
): ParentPool | null {
  const url = parentUrlSchema.safeParse(env[PARENT_URL_ENV]);
  const token = parentTokenSchema.safeParse(env[PARENT_TOKEN_ENV]);
  if (!url.success || !token.success) return null;
  return {
    baseUrl: url.data.replace(/\/+$/u, ""),
    token: token.data,
  };
}

export function parentRequestHeaders(inbound: Headers, token: string): Headers {
  const headers = new Headers();
  for (const [name, value] of inbound) {
    const lower = name.toLowerCase();
    if (
      lower === "authorization" ||
      lower === "x-api-key" ||
      lower === HUB_TOKEN_HEADER ||
      lower === "host" ||
      lower === "content-length" ||
      lower === "connection"
    ) {
      continue;
    }
    headers.append(name, value);
  }
  headers.set(HUB_TOKEN_HEADER, token);
  return headers;
}

interface ParentAvailabilityOptions {
  parent: ParentPool;
  fetch: typeof fetch;
  now: () => number;
  ttlMs?: number;
  onError?: (error: unknown) => void;
}

export class ParentAvailability {
  private cached: { value: PoolAvailability; expiresAt: number } | null = null;

  constructor(private readonly options: ParentAvailabilityOptions) {}

  async get(): Promise<PoolAvailability> {
    const cached = this.cached;
    if (cached !== null && cached.expiresAt > this.options.now()) {
      return cached.value;
    }
    const value = await this.load();
    const ttlMs = this.options.ttlMs ?? DEFAULT_AVAILABILITY_TTL_MS;
    this.cached = { value, expiresAt: this.options.now() + ttlMs };
    return value;
  }

  private async load(): Promise<PoolAvailability> {
    try {
      const response = await this.options.fetch(
        `${this.options.parent.baseUrl}${AVAILABILITY_PATH}`,
        {
          method: "GET",
          headers: { [HUB_TOKEN_HEADER]: this.options.parent.token },
          signal: AbortSignal.timeout(AVAILABILITY_TIMEOUT_MS),
        },
      );
      if (response.ok) {
        return poolAvailabilitySchema.parse(await response.json());
      }
      this.options.onError?.(
        new Error(`parent availability returned HTTP ${response.status}`),
      );
    } catch (error) {
      this.options.onError?.(error);
    }
    return UNAVAILABLE_POOL;
  }
}
