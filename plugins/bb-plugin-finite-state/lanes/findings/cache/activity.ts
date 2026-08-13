import type Database from "better-sqlite3";
import type { Json, PlatformClient } from "../../../lib/remote/types.js";
import { getCachedFinding } from "./query.js";
import { FindingsCacheError, type CacheMetadata, type CachedActivity } from "./types.js";

interface ActivityRow {
  project_id: string;
  project_version_id: string;
  finding_id: string;
  event_id: string;
  stable_key: string;
  actor: string | null;
  event_at: string;
  source: string | null;
  old_tuple: string | null;
  new_tuple: string | null;
  raw: string;
  pulled_at: string;
}

interface NormalizedActivity {
  eventId: string;
  actor: string | null;
  eventAt: string;
  source: string | null;
  oldTuple: string | null;
  newTuple: string | null;
  raw: string;
}

function record(value: Json): Record<string, Json> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function stringValue(row: Record<string, Json>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.normalize("NFC").trim();
  }
  return null;
}

function normalizeActivity(value: Json): NormalizedActivity {
  const row = record(value);
  if (!row) throw new FindingsCacheError("FINDING_ACTIVITY_INVALID", "Activity event must be an object");
  const eventId = stringValue(row, ["id", "eventId", "uuid"]);
  const eventAt = stringValue(row, ["at", "eventAt", "createdAt", "timestamp"]);
  if (!eventId || !eventAt) {
    throw new FindingsCacheError("FINDING_ACTIVITY_INVALID", "Activity event is missing id or time");
  }
  return {
    eventId,
    actor: stringValue(row, ["actor", "actorLabel", "user"]),
    eventAt,
    source: stringValue(row, ["source", "action", "type"]),
    oldTuple: row.old !== undefined ? JSON.stringify(row.old) : row.oldTuple !== undefined ? JSON.stringify(row.oldTuple) : null,
    newTuple: row.new !== undefined ? JSON.stringify(row.new) : row.newTuple !== undefined ? JSON.stringify(row.newTuple) : null,
    raw: JSON.stringify(row),
  };
}

function parseJson(value: string | null): Json {
  if (value === null) return null;
  try {
    return JSON.parse(value) as Json;
  } catch {
    return null;
  }
}

function fromRow(row: ActivityRow): CachedActivity {
  return {
    projectId: row.project_id,
    projectVersionId: row.project_version_id,
    findingId: row.finding_id,
    eventId: row.event_id,
    stableKey: row.stable_key,
    actor: row.actor,
    eventAt: row.event_at,
    source: row.source,
    oldTuple: parseJson(row.old_tuple),
    newTuple: parseJson(row.new_tuple),
    raw: parseJson(row.raw) as Record<string, Json>,
    pulledAt: row.pulled_at,
  };
}

export async function hydrateFindingActivity(
  db: Database.Database,
  platform: Pick<PlatformClient, "getFindingActivity">,
  input: { projectId: string; projectVersionId: string; findingId: string },
  now: () => Date = () => new Date(),
): Promise<number> {
  const cached = getCachedFinding(db, input.projectId, input.projectVersionId, input.findingId);
  if (!cached.finding || !cached.cache.acceptedGenerationId) {
    throw new FindingsCacheError("FINDING_NOT_FOUND", "Finding is not present in the accepted cache");
  }
  if (!cached.finding.cve) {
    throw new FindingsCacheError("FINDING_ACTIVITY_UNAVAILABLE", "Finding has no activity lookup identifier");
  }
  const finding = cached.finding;
  const events: NormalizedActivity[] = [];
  for await (const page of platform.getFindingActivity({
    projectId: input.projectId,
    projectVersionId: input.projectVersionId,
    cve: finding.cve!,
    page: { pageSize: 200 },
  })) {
    for (const item of page.items) events.push(normalizeActivity(item));
  }
  const pulledAt = now().toISOString();
  db.transaction(() => {
    db.prepare(
      `DELETE FROM finding_activity
        WHERE project_id = ? AND project_version_id = ? AND generation_id = ? AND finding_id = ?`,
    ).run(input.projectId, input.projectVersionId, cached.cache.acceptedGenerationId, input.findingId);
    const insert = db.prepare(
      `INSERT INTO finding_activity
         (project_id, project_version_id, generation_id, finding_id, event_id, stable_key,
          actor, event_at, source, old_tuple, new_tuple, raw, pulled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const event of events) {
      insert.run(
        input.projectId, input.projectVersionId, cached.cache.acceptedGenerationId,
        input.findingId, event.eventId, finding.stableKey, event.actor,
        event.eventAt, event.source, event.oldTuple, event.newTuple, event.raw, pulledAt,
      );
    }
  })();
  return events.length;
}

function activityCursor(eventAt: string, eventId: string): string {
  return Buffer.from(JSON.stringify({ eventAt, eventId }), "utf8").toString("base64url");
}

function parseCursor(cursor: string): { eventAt: string; eventId: string } {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof value.eventAt === "string" && typeof value.eventId === "string") {
      return { eventAt: value.eventAt, eventId: value.eventId };
    }
  } catch {
    // Converted to the stable error below.
  }
  throw new FindingsCacheError("FINDING_ACTIVITY_BAD_CURSOR", "Activity cursor is invalid");
}

export function listFindingActivity(
  db: Database.Database,
  input: {
    projectId: string;
    projectVersionId: string;
    findingId: string;
    limit: number;
    cursor?: string;
  },
): { items: CachedActivity[]; total: number; next: string | null; cache: CacheMetadata } {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200) {
    throw new FindingsCacheError("FINDING_ACTIVITY_LIMIT_INVALID", "Activity limit must be between 1 and 200");
  }
  const cached = getCachedFinding(db, input.projectId, input.projectVersionId, input.findingId);
  if (!cached.cache.acceptedGenerationId) return { items: [], total: 0, next: null, cache: cached.cache };
  const parameters: Array<string | number> = [
    input.projectId, input.projectVersionId, cached.cache.acceptedGenerationId, input.findingId,
  ];
  let cursorSql = "";
  if (input.cursor) {
    const cursor = parseCursor(input.cursor);
    cursorSql = " AND (event_at < ? OR (event_at = ? AND event_id > ?))";
    parameters.push(cursor.eventAt, cursor.eventAt, cursor.eventId);
  }
  const total = (db.prepare(
    `SELECT COUNT(*) AS count FROM finding_activity
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ? AND finding_id = ?`,
  ).get(input.projectId, input.projectVersionId, cached.cache.acceptedGenerationId, input.findingId) as { count: number }).count;
  const rows = db.prepare(
    `SELECT * FROM finding_activity
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ? AND finding_id = ?${cursorSql}
      ORDER BY event_at DESC, event_id ASC LIMIT ?`,
  ).all(...parameters, input.limit + 1) as ActivityRow[];
  const hasMore = rows.length > input.limit;
  const visible = hasMore ? rows.slice(0, input.limit) : rows;
  const last = visible.at(-1);
  return {
    items: visible.map(fromRow),
    total,
    next: hasMore && last ? activityCursor(last.event_at, last.event_id) : null,
    cache: cached.cache,
  };
}
