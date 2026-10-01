import { and, eq, isNull } from "drizzle-orm";
import type { ConnectDb } from "./availability.js";
import { sha256Hex } from "./crypto.js";
import { server } from "./schema.js";

export const SERVER_CREDENTIAL_HEADER = "x-bb-connect-machine";

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

export function serverCredentialFromHeaders(headers: Headers): string {
  const authorization = headers.get("authorization")?.trim() ?? "";
  const bearer = /^Bearer\s+(\S+)$/iu.exec(authorization)?.[1];
  if (bearer) return bearer;
  return headers.get(SERVER_CREDENTIAL_HEADER)?.trim() ?? "";
}
