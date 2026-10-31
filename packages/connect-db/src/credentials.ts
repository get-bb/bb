import { and, eq, isNull } from "drizzle-orm";
import type { ConnectDb } from "./availability.js";
import { sha256Hex } from "./crypto.js";
import { server } from "./schema.js";

export const SERVER_CREDENTIAL_HEADER = "x-bb-connect-machine";
export const SERVER_CREDENTIAL_CACHE_TTL_MS = 20_000;

export type ServerRow = typeof server.$inferSelect;

export interface ResolvedServerCredential {
  server: ServerRow;
  userId: string;
}

export async function resolveServerCredential(
  db: ConnectDb,
  credential: string,
): Promise<ResolvedServerCredential | null> {
  const presented = credential.trim();
  if (!presented) return null;
  const row = await db
    .select()
    .from(server)
    .where(
      and(
        eq(server.credentialHash, await sha256Hex(presented)),
        isNull(server.revokedAt),
      ),
    )
    .get();
  return row ? { server: row, userId: row.userId } : null;
}

interface CachedServerCredential {
  value: ResolvedServerCredential | null;
  expires: number;
}

export class ServerCredentialCache {
  readonly #entries = new Map<string, CachedServerCredential>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async resolve(
    db: ConnectDb,
    credential: string,
  ): Promise<ResolvedServerCredential | null> {
    const presented = credential.trim();
    if (!presented) return null;
    const now = this.now();
    const cached = this.#entries.get(presented);
    if (cached && cached.expires > now) return cached.value;
    if (cached) this.#entries.delete(presented);
    const value = await resolveServerCredential(db, presented);
    this.#entries.set(presented, { value, expires: now + this.ttlMs });
    return value;
  }

  forget(credential: string): void {
    this.#entries.delete(credential.trim());
  }
}

export function serverCredentialFromHeaders(headers: Headers): string {
  const authorization = headers.get("authorization")?.trim() ?? "";
  const bearer = /^Bearer\s+(\S+)$/iu.exec(authorization)?.[1];
  if (bearer) return bearer;
  return headers.get(SERVER_CREDENTIAL_HEADER)?.trim() ?? "";
}
