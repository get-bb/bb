import type Database from "better-sqlite3";
import type { Json, PlatformClient } from "../../../lib/remote/types.js";
import { getCachedFinding } from "./query.js";
import { FindingsCacheError, type CacheMetadata, type CachedComment } from "./types.js";

function record(value: Json): Record<string, Json> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function normalizeComment(value: Json, findingId: string): CachedComment {
  const row = record(value);
  if (!row) throw new FindingsCacheError("FINDING_COMMENT_INVALID", "Finding comment must be an object");
  const id = typeof row.id === "string" ? row.id : null;
  const text = typeof row.text === "string" ? row.text : typeof row.body === "string" ? row.body : null;
  const createdAt = typeof row.createdAt === "string" ? row.createdAt : null;
  if (!id || text === null || !createdAt) {
    throw new FindingsCacheError("FINDING_COMMENT_INVALID", "Finding comment is missing id, text, or creation time");
  }
  return {
    id,
    findingId,
    actorLabel: typeof row.actorLabel === "string" ? row.actorLabel : typeof row.actor === "string" ? row.actor : null,
    text,
    createdAt,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
  };
}

export async function hydrateFindingComments(
  db: Database.Database,
  platform: Pick<PlatformClient, "listFindingComments">,
  input: { projectId: string; projectVersionId: string; findingId: string },
): Promise<number> {
  const cached = getCachedFinding(db, input.projectId, input.projectVersionId, input.findingId);
  if (!cached.finding || !cached.cache.acceptedGenerationId) {
    throw new FindingsCacheError("FINDING_NOT_FOUND", "Finding is not present in the accepted cache");
  }
  const comments: CachedComment[] = [];
  for await (const page of platform.listFindingComments({
    projectVersionId: input.projectVersionId,
    findingId: input.findingId,
    page: { pageSize: 200 },
  })) {
    for (const item of page.items) comments.push(normalizeComment(item, input.findingId));
  }
  const updated = db.prepare(
    `UPDATE findings SET comments = ?
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ? AND finding_id = ?`,
  ).run(
    JSON.stringify(comments), input.projectId, input.projectVersionId,
    cached.cache.acceptedGenerationId, input.findingId,
  );
  if (updated.changes !== 1) {
    throw new FindingsCacheError("FINDING_CACHE_MOVED", "Finding cache generation moved during comment refresh");
  }
  return comments.length;
}

function encodeOffset(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeOffset(cursor: string): number {
  const value = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!Number.isInteger(value) || value < 0) {
    throw new FindingsCacheError("FINDING_COMMENTS_BAD_CURSOR", "Comments cursor is invalid");
  }
  return value;
}

export function listFindingComments(
  db: Database.Database,
  input: {
    projectId: string;
    projectVersionId: string;
    findingId: string;
    limit: number;
    cursor?: string;
  },
): { items: CachedComment[]; total: number; next: string | null; cache: CacheMetadata } {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200) {
    throw new FindingsCacheError("FINDING_COMMENTS_LIMIT_INVALID", "Comments limit must be between 1 and 200");
  }
  const cached = getCachedFinding(db, input.projectId, input.projectVersionId, input.findingId);
  const all = cached.finding?.comments ?? [];
  const offset = input.cursor ? decodeOffset(input.cursor) : 0;
  if (offset > all.length) throw new FindingsCacheError("FINDING_COMMENTS_BAD_CURSOR", "Comments cursor is out of range");
  const items = all.slice(offset, offset + input.limit);
  const nextOffset = offset + items.length;
  return {
    items,
    total: all.length,
    next: nextOffset < all.length ? encodeOffset(nextOffset) : null,
    cache: cached.cache,
  };
}

/** Frozen v1 policy: comment mutations have no actor-authenticated capability mint. */
export function commentMutationAuthorizationUnavailable(): never {
  throw new FindingsCacheError(
    "authorization-unavailable",
    "Comment mutation requires an actor-authenticated single-use capability; refresh before retrying any ambiguous external attempt",
  );
}
