import { randomBytes } from "node:crypto";
import {
  defineRpcContract,
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { isMemoryKind, MEMORY_KINDS, type MemoryKind } from "./memory-kinds.js";

const CATALOG_MAX_CHARS = 3_900;
const DEFAULT_RESULT_LIMIT = 20;
const MAX_RESULT_LIMIT = 100;
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const TAG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,39}$/;

type MemoryScope = "global" | "project";
type ReadScope = MemoryScope | "all";
type PluginDatabase = ReturnType<BbPluginApi["storage"]["database"]>;

interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  projectId: string | null;
  name: string;
  summary: string;
  details: string;
  kind: MemoryKind;
  tags: string[];
  importance: number;
  pinned: boolean;
  sourceThreadId: string | null;
  writeReason: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

const memoryKindSchema = z.enum(MEMORY_KINDS);
const memoryRecordSchema: z.ZodType<MemoryRecord> = z
  .object({
    id: z.string(),
    scope: z.enum(["global", "project"]),
    projectId: z.string().nullable(),
    name: z.string(),
    summary: z.string(),
    details: z.string(),
    kind: memoryKindSchema,
    tags: z.array(z.string()),
    importance: z.number().int().min(0).max(100),
    pinned: z.boolean(),
    sourceThreadId: z.string().nullable(),
    writeReason: z.string(),
    version: z.number().int().positive(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();

const memoryUpdateInputSchema = z
  .object({
    id: z.string(),
    expectedVersion: z.number().int().positive(),
    summary: z.string(),
    details: z.string(),
    kind: memoryKindSchema,
    tags: z.array(z.string()),
    importance: z.number().int().min(0).max(100),
    pinned: z.boolean(),
  })
  .strict();

export const memoryRpcContract = defineRpcContract({
  listMemories: {
    input: z.null(),
    output: z.object({ memories: z.array(memoryRecordSchema) }).strict(),
  },
  updateMemory: {
    input: memoryUpdateInputSchema,
    output: z.object({ memory: memoryRecordSchema }).strict(),
  },
  deleteMemory: {
    input: z
      .object({
        id: z.string(),
        expectedVersion: z.number().int().positive(),
      })
      .strict(),
    output: z
      .object({
        deleted: z
          .object({ id: z.string(), version: z.number().int().positive() })
          .strict(),
      })
      .strict(),
  },
});

type MemorySummary = Omit<
  MemoryRecord,
  "details" | "sourceThreadId" | "writeReason" | "createdAt"
>;

interface MemoryCreate {
  scope: MemoryScope;
  projectId: string | null;
  name: string;
  summary: string;
  details: string;
  kind: MemoryKind;
  tags: string[];
  importance: number;
  pinned: boolean;
  sourceThreadId: string | null;
  writeReason: string;
}

interface MemoryUpdate {
  expectedVersion: number;
  summary?: string;
  details?: string;
  kind?: MemoryKind;
  tags?: string[];
  importance?: number;
  pinned?: boolean;
  sourceThreadId: string | null;
  writeReason: string;
}

class CliError extends PluginCliError {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTags(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

function parseMemoryRow(row: unknown): MemoryRecord {
  if (!isRecord(row))
    throw new Error("memory database returned an invalid row");
  const scope: MemoryScope = row.scope === "project" ? "project" : "global";
  const kind = isMemoryKind(row.kind) ? row.kind : "fact";
  return {
    id: String(row.id),
    scope,
    projectId: typeof row.project_id === "string" ? row.project_id : null,
    name: String(row.name),
    summary: String(row.summary),
    details: String(row.details),
    kind,
    tags: parseTags(row.tags_json),
    importance: Number(row.importance),
    pinned: Number(row.pinned) === 1,
    sourceThreadId:
      typeof row.source_thread_id === "string" ? row.source_thread_id : null,
    writeReason: String(row.write_reason),
    version: Number(row.version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function toMemorySummary(memory: MemoryRecord): MemorySummary {
  return {
    id: memory.id,
    scope: memory.scope,
    projectId: memory.projectId,
    name: memory.name,
    summary: memory.summary,
    kind: memory.kind,
    tags: memory.tags,
    importance: memory.importance,
    pinned: memory.pinned,
    version: memory.version,
    updatedAt: memory.updatedAt,
  };
}

function createMemoryId(): string {
  return `mem_${randomBytes(8).toString("base64url").toLowerCase()}`;
}

function scopeKey(scope: MemoryScope, projectId: string | null): string {
  return scope === "global" ? "global" : `project:${projectId ?? "missing"}`;
}

function normalizeOneLine(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unsafeMemoryReason(value: string): string | null {
  if (/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(value)) {
    return "contains invisible or bidirectional control characters";
  }
  if (/<\/?\s*(system|developer|assistant|tool)(?:\s|>)/iu.test(value)) {
    return "contains a role-like prompt tag";
  }
  if (
    /\b(ignore|disregard|override)\b.{0,50}\b(previous|prior|system|developer)\b/isu.test(
      value,
    )
  ) {
    return "looks like a prompt-injection instruction";
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(value)) {
    return "contains a private key";
  }
  if (/\b(?:sk-[a-z0-9_-]{20,}|gh[pousr]_[a-z0-9]{20,})\b/iu.test(value)) {
    return "contains a token-like secret";
  }
  if (/\b[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY)\s*=\s*\S+/u.test(value)) {
    return "contains a credential assignment";
  }
  return null;
}

function validateText(label: string, value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new CliError(`${label} must not be empty`);
  if (trimmed.length > maxChars) {
    throw new CliError(`${label} must be at most ${maxChars} characters`);
  }
  const unsafe = unsafeMemoryReason(trimmed);
  if (unsafe) throw new CliError(`${label} ${unsafe}; memory was not written`);
  return trimmed;
}

function validateName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!NAME_PATTERN.test(normalized)) {
    throw new CliError(
      "name must be 1-80 lowercase letters, digits, dots, underscores, or hyphens",
    );
  }
  return normalized;
}

function validateTags(values: string[]): string[] {
  const tags = [...new Set(values.map((tag) => tag.trim().toLowerCase()))];
  if (tags.length > 20) throw new CliError("at most 20 tags are allowed");
  for (const tag of tags) {
    if (!TAG_PATTERN.test(tag)) {
      throw new CliError(
        `invalid tag "${tag}"; use lowercase letters, digits, dots, underscores, or hyphens`,
      );
    }
  }
  return tags;
}

function writeScope(
  scope: MemoryScope,
  projectId: string | undefined,
): { scope: MemoryScope; projectId: string | null } {
  if (scope === "global") return { scope: "global", projectId: null };
  if (projectId === undefined) {
    throw new CliError(
      "project-scoped memory requires a BB project context; run inside a project thread",
    );
  }
  return { scope: "project", projectId };
}

function scopeSql(
  scope: ReadScope,
  projectId: string | undefined,
): { sql: string; params: string[] } {
  if (scope === "global") {
    return { sql: "m.scope = 'global'", params: [] };
  }
  if (scope === "project") {
    if (!projectId)
      throw new CliError("project scope requires a BB project context");
    return {
      sql: "m.scope = 'project' AND m.project_id = ?",
      params: [projectId],
    };
  }
  if (!projectId) return { sql: "m.scope = 'global'", params: [] };
  return {
    sql: "(m.scope = 'global' OR (m.scope = 'project' AND m.project_id = ?))",
    params: [projectId],
  };
}

function searchExpression(query: string): string {
  const tokens = query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  if (tokens.length === 0)
    throw new CliError("search query has no searchable terms");
  return [...new Set(tokens)]
    .slice(0, 12)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(" OR ");
}

function memorySnapshot(memory: MemoryRecord): Record<string, unknown> {
  return {
    id: memory.id,
    scope: memory.scope,
    projectId: memory.projectId,
    name: memory.name,
    summary: memory.summary,
    details: memory.details,
    kind: memory.kind,
    tags: memory.tags,
    importance: memory.importance,
    pinned: memory.pinned,
    sourceThreadId: memory.sourceThreadId,
    writeReason: memory.writeReason,
    version: memory.version,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

class MemoryStore {
  constructor(private readonly db: PluginDatabase) {}

  add(input: MemoryCreate): MemoryRecord {
    const now = Date.now();
    const id = createMemoryId();
    const record: MemoryRecord = {
      id,
      scope: input.scope,
      projectId: input.projectId,
      name: validateName(input.name),
      summary: validateText("summary", input.summary, 400),
      details: validateText("details", input.details, 16_000),
      kind: input.kind,
      tags: validateTags(input.tags),
      importance: input.importance,
      pinned: input.pinned,
      sourceThreadId: input.sourceThreadId,
      writeReason: validateText("reason", input.writeReason, 500),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    try {
      this.db.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO memories (
               id, scope, scope_key, project_id, name, summary, details, kind,
               tags_json, importance, pinned, source_thread_id, write_reason,
               version, created_at, updated_at, deleted_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          )
          .run(
            record.id,
            record.scope,
            scopeKey(record.scope, record.projectId),
            record.projectId,
            record.name,
            record.summary,
            record.details,
            record.kind,
            JSON.stringify(record.tags),
            record.importance,
            record.pinned ? 1 : 0,
            record.sourceThreadId,
            record.writeReason,
            record.version,
            record.createdAt,
            record.updatedAt,
          );
        this.insertHistory(
          record,
          "create",
          record.sourceThreadId,
          record.writeReason,
        );
      })();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("UNIQUE constraint failed")
      ) {
        throw new CliError(
          `an active ${record.scope} memory named "${record.name}" already exists`,
        );
      }
      throw error;
    }
    return record;
  }

  update(
    id: string,
    input: MemoryUpdate,
    ctxProjectId: string | undefined,
  ): MemoryRecord {
    return this.db.transaction(() => {
      const current = this.get(id, "all", ctxProjectId, false);
      if (!current)
        throw new CliError(`memory "${id}" was not found in the current scope`);
      if (current.version !== input.expectedVersion) {
        throw new CliError(
          `version conflict for ${id}: expected ${input.expectedVersion}, current ${current.version}`,
        );
      }
      const updated: MemoryRecord = {
        ...current,
        summary:
          input.summary === undefined
            ? current.summary
            : validateText("summary", input.summary, 400),
        details:
          input.details === undefined
            ? current.details
            : validateText("details", input.details, 16_000),
        kind: input.kind ?? current.kind,
        tags:
          input.tags === undefined ? current.tags : validateTags(input.tags),
        importance: input.importance ?? current.importance,
        pinned: input.pinned ?? current.pinned,
        sourceThreadId: input.sourceThreadId,
        writeReason: validateText("reason", input.writeReason, 500),
        version: current.version + 1,
        updatedAt: Date.now(),
      };
      const result = this.db
        .prepare(
          `UPDATE memories SET
             summary = ?, details = ?, kind = ?, tags_json = ?, importance = ?,
             pinned = ?, source_thread_id = ?, write_reason = ?, version = ?, updated_at = ?
           WHERE id = ? AND version = ? AND deleted_at IS NULL`,
        )
        .run(
          updated.summary,
          updated.details,
          updated.kind,
          JSON.stringify(updated.tags),
          updated.importance,
          updated.pinned ? 1 : 0,
          updated.sourceThreadId,
          updated.writeReason,
          updated.version,
          updated.updatedAt,
          updated.id,
          current.version,
        );
      if (result.changes !== 1)
        throw new CliError(`memory ${id} changed concurrently; retry`);
      this.insertHistory(
        updated,
        "update",
        updated.sourceThreadId,
        updated.writeReason,
      );
      return updated;
    })();
  }

  forget(
    id: string,
    expectedVersion: number,
    reason: string,
    sourceThreadId: string | null,
    ctxProjectId: string | undefined,
  ): MemoryRecord {
    return this.db.transaction(() => {
      const current = this.get(id, "all", ctxProjectId, false);
      if (!current)
        throw new CliError(`memory "${id}" was not found in the current scope`);
      if (current.version !== expectedVersion) {
        throw new CliError(
          `version conflict for ${id}: expected ${expectedVersion}, current ${current.version}`,
        );
      }
      const writeReason = validateText("reason", reason, 500);
      const forgotten: MemoryRecord = {
        ...current,
        sourceThreadId,
        writeReason,
        version: current.version + 1,
        updatedAt: Date.now(),
      };
      const result = this.db
        .prepare(
          `UPDATE memories SET deleted_at = ?, source_thread_id = ?, write_reason = ?,
             version = ?, updated_at = ?
           WHERE id = ? AND version = ? AND deleted_at IS NULL`,
        )
        .run(
          forgotten.updatedAt,
          sourceThreadId,
          writeReason,
          forgotten.version,
          forgotten.updatedAt,
          id,
          current.version,
        );
      if (result.changes !== 1)
        throw new CliError(`memory ${id} changed concurrently; retry`);
      this.insertHistory(forgotten, "forget", sourceThreadId, writeReason);
      return forgotten;
    })();
  }

  get(
    idOrName: string,
    scope: ReadScope,
    projectId: string | undefined,
    touch = true,
  ): MemoryRecord | null {
    const scoped = scopeSql(scope, projectId);
    const row: unknown = this.db
      .prepare(
        `SELECT m.* FROM memories m
         WHERE m.deleted_at IS NULL AND (m.id = ? OR m.name = ?) AND ${scoped.sql}
         ORDER BY CASE WHEN m.scope = 'project' THEN 0 ELSE 1 END, m.updated_at DESC
         LIMIT 1`,
      )
      .get(idOrName, idOrName, ...scoped.params);
    if (row === undefined) return null;
    const memory = parseMemoryRow(row);
    if (touch) {
      this.db
        .prepare(
          "UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?",
        )
        .run(Date.now(), memory.id);
    }
    return memory;
  }

  list(
    scope: ReadScope,
    projectId: string | undefined,
    limit: number,
  ): {
    memories: MemoryRecord[];
    total: number;
  } {
    const scoped = scopeSql(scope, projectId);
    const rows: unknown[] = this.db
      .prepare(
        `SELECT m.* FROM memories m
         WHERE m.deleted_at IS NULL AND ${scoped.sql}
         ORDER BY m.pinned DESC,
           CASE WHEN m.scope = 'project' THEN 0 ELSE 1 END,
           m.importance DESC, COALESCE(m.last_accessed_at, 0) DESC,
           m.updated_at DESC, m.name ASC
         LIMIT ?`,
      )
      .all(...scoped.params, limit);
    const countRow: unknown = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM memories m
         WHERE m.deleted_at IS NULL AND ${scoped.sql}`,
      )
      .get(...scoped.params);
    const total = isRecord(countRow) ? Number(countRow.count) : 0;
    return { memories: rows.map(parseMemoryRow), total };
  }

  listAll(): MemoryRecord[] {
    const rows: unknown[] = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE deleted_at IS NULL
         ORDER BY pinned DESC, scope ASC, project_id ASC, importance DESC,
           updated_at DESC, name ASC`,
      )
      .all();
    return rows.map(parseMemoryRow);
  }

  getAdmin(id: string): MemoryRecord | null {
    const row: unknown = this.db
      .prepare("SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL")
      .get(id);
    return row === undefined ? null : parseMemoryRow(row);
  }

  search(
    query: string,
    scope: ReadScope,
    projectId: string | undefined,
    limit: number,
  ): MemoryRecord[] {
    const scoped = scopeSql(scope, projectId);
    const rows: unknown[] = this.db
      .prepare(
        `SELECT m.* FROM memories_fts f
         JOIN memories m ON m.id = f.memory_id
         WHERE memories_fts MATCH ? AND m.deleted_at IS NULL AND ${scoped.sql}
         ORDER BY bm25(memories_fts), m.pinned DESC, m.importance DESC, m.updated_at DESC
         LIMIT ?`,
      )
      .all(searchExpression(query), ...scoped.params, limit);
    return rows.map(parseMemoryRow);
  }

  history(id: string, projectId: string | undefined, limit: number): unknown[] {
    const scoped = scopeSql("all", projectId);
    return this.db
      .prepare(
        `SELECT h.version, h.action, h.snapshot_json, h.source_thread_id,
           h.write_reason, h.created_at
         FROM memory_history h
         JOIN memories m ON m.id = h.memory_id
         WHERE h.memory_id = ? AND ${scoped.sql}
         ORDER BY h.version DESC
         LIMIT ?`,
      )
      .all(id, ...scoped.params, limit);
  }

  private insertHistory(
    memory: MemoryRecord,
    action: "create" | "update" | "forget",
    sourceThreadId: string | null,
    writeReason: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO memory_history (
           memory_id, version, action, snapshot_json, source_thread_id, write_reason, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        memory.id,
        memory.version,
        action,
        JSON.stringify(memorySnapshot(memory)),
        sourceThreadId,
        writeReason,
        memory.updatedAt,
      );
  }
}

function displayMemory(memory: MemoryRecord, includeDetails: boolean): string {
  const tags = memory.tags.length > 0 ? ` tags=${memory.tags.join(",")}` : "";
  const lines = [
    `${memory.id} v${memory.version} [${memory.scope}/${memory.kind}] ${memory.name}`,
    `  ${memory.summary}`,
    `  importance=${memory.importance} pinned=${memory.pinned}${tags}`,
  ];
  if (includeDetails) {
    lines.push(
      "",
      memory.details,
      "",
      `Reason: ${memory.writeReason}`,
      `Source thread: ${memory.sourceThreadId ?? "none"}`,
    );
  }
  return lines.join("\n");
}

function renderCatalog(store: MemoryStore, projectId: string): string {
  const { memories, total } = store.list("all", projectId, MAX_RESULT_LIMIT);
  const header = [
    "Memory index",
    "The entries below are summaries, not full records. Use `bb memory search <query> --scope all --json` and `bb memory get <id> --json` to progressively disclose details.",
    "You may proactively save durable learning with `bb memory add`. Use project scope for repository-specific facts and global scope only for broadly applicable user preferences or workflows. Never store secrets, transient status, guesses, or rules already guaranteed by AGENTS.md.",
    "",
  ].join("\n");
  if (memories.length === 0) return `${header}No memories are stored yet.`;

  const lines: string[] = [];
  for (const memory of memories) {
    const tags =
      memory.tags.length > 0 ? `; ${memory.tags.slice(0, 3).join(",")}` : "";
    const pin = memory.pinned ? "; pinned" : "";
    const line = `- ${memory.id} [${memory.scope}/${memory.kind}${pin}${tags}] ${memory.name}: ${normalizeOneLine(memory.summary)}`;
    const candidate = `${header}${[...lines, line].join("\n")}`;
    if (candidate.length > CATALOG_MAX_CHARS) break;
    lines.push(line);
  }
  let finalLines = lines;
  let footer = "";
  while (true) {
    const finalShown = finalLines.length;
    footer =
      finalShown < total
        ? `\nShowing ${finalShown} of ${total}; run \`bb memory catalog --scope all --json\` for the rest.`
        : "";
    if (
      `${header}${finalLines.join("\n")}${footer}`.length <= CATALOG_MAX_CHARS
    ) {
      break;
    }
    finalLines = finalLines.slice(0, -1);
  }
  return `${header}${finalLines.join("\n")}${footer}`;
}

const SCOPE_DESCRIPTION = "Which memories to read";
const READ_SCOPES = ["all", "project", "global"] as const;
const MAX_EXPECTED_VERSION = Number.MAX_SAFE_INTEGER;

function jsonOutput(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS memories (
       id TEXT PRIMARY KEY,
       scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
       scope_key TEXT NOT NULL,
       project_id TEXT,
       name TEXT NOT NULL,
       summary TEXT NOT NULL,
       details TEXT NOT NULL,
       kind TEXT NOT NULL,
       tags_json TEXT NOT NULL,
       importance INTEGER NOT NULL CHECK (importance BETWEEN 0 AND 100),
       pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
       source_thread_id TEXT,
       write_reason TEXT NOT NULL,
       version INTEGER NOT NULL,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       deleted_at INTEGER,
       last_accessed_at INTEGER,
       access_count INTEGER NOT NULL DEFAULT 0,
       CHECK ((scope = 'global' AND project_id IS NULL) OR (scope = 'project' AND project_id IS NOT NULL))
     );
     CREATE UNIQUE INDEX IF NOT EXISTS memories_active_scope_name
       ON memories(scope_key, name) WHERE deleted_at IS NULL;
     CREATE INDEX IF NOT EXISTS memories_catalog
       ON memories(scope, project_id, deleted_at, pinned, importance, updated_at);
     CREATE TABLE IF NOT EXISTS memory_history (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       memory_id TEXT NOT NULL,
       version INTEGER NOT NULL,
       action TEXT NOT NULL CHECK (action IN ('create', 'update', 'forget')),
       snapshot_json TEXT NOT NULL,
       source_thread_id TEXT,
       write_reason TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       UNIQUE(memory_id, version)
     );
     CREATE INDEX IF NOT EXISTS memory_history_memory
       ON memory_history(memory_id, version DESC);
     CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
       memory_id UNINDEXED, name, summary, details, tags
     );
     CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
       INSERT INTO memories_fts(memory_id, name, summary, details, tags)
       VALUES (new.id, new.name, new.summary, new.details, new.tags_json);
     END;
     CREATE TRIGGER IF NOT EXISTS memories_fts_update
       AFTER UPDATE OF name, summary, details, tags_json ON memories BEGIN
       DELETE FROM memories_fts WHERE memory_id = old.id;
       INSERT INTO memories_fts(memory_id, name, summary, details, tags)
       VALUES (new.id, new.name, new.summary, new.details, new.tags_json);
     END;
     CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
       DELETE FROM memories_fts WHERE memory_id = old.id;
     END;`,
  ]);
  const store = new MemoryStore(db);

  bb.rpc.register(memoryRpcContract, {
    listMemories() {
      return { memories: store.listAll() };
    },
    updateMemory(input) {
      const { id } = input;
      const current = store.getAdmin(id);
      if (!current) throw new Error(`memory "${id}" was not found`);
      const memory = store.update(
        id,
        {
          expectedVersion: input.expectedVersion,
          summary: input.summary,
          details: input.details,
          kind: input.kind,
          tags: input.tags,
          importance: input.importance,
          pinned: input.pinned,
          sourceThreadId: null,
          writeReason: "Edited in Memory settings",
        },
        current.projectId ?? undefined,
      );
      return { memory };
    },
    deleteMemory(input) {
      const { id } = input;
      const current = store.getAdmin(id);
      if (!current) throw new Error(`memory "${id}" was not found`);
      const memory = store.forget(
        id,
        input.expectedVersion,
        "Deleted in Memory settings",
        null,
        current.projectId ?? undefined,
      );
      return { deleted: { id: memory.id, version: memory.version } };
    },
  });

  bb.agents.contributeInstructions(({ projectId }) =>
    renderCatalog(store, projectId),
  );

  bb.cli.register(
    defineCli({
      name: "memory",
      summary: "Read and maintain durable global and project memories",
      description:
        "Memories are summaries first: search or list, then read one in full.\nProject scope holds repository facts; global scope holds durable user preferences.",
      commands: {
        catalog: cliCommand({
          summary: "List compact memory summaries",
          aliases: ["list"],
          options: {
            scope: {
              type: "enum",
              values: READ_SCOPES,
              default: "all",
              description: SCOPE_DESCRIPTION,
            },
            limit: {
              type: "integer",
              min: 1,
              max: MAX_RESULT_LIMIT,
              default: DEFAULT_RESULT_LIMIT,
              description: "How many memories to list",
            },
            json: {
              type: "boolean",
              description: "Emit machine-readable JSON",
            },
          },
          run(input, ctx) {
            const { scope, limit } = input.options;
            const result = store.list(scope, ctx.projectId, limit);
            return {
              exitCode: 0,
              stdout: input.options.json
                ? jsonOutput({
                    ok: true,
                    scope,
                    memories: result.memories.map(toMemorySummary),
                    total: result.total,
                  })
                : result.memories
                    .map((memory) => displayMemory(memory, false))
                    .join("\n") || "No memories.",
            };
          },
        }),
        search: cliCommand({
          summary: "Search memory summaries and details",
          positionals: [
            {
              name: "query",
              description: "Words to match; every word is searched",
              required: true,
              variadic: true,
            },
          ],
          options: {
            scope: {
              type: "enum",
              values: READ_SCOPES,
              default: "all",
              description: SCOPE_DESCRIPTION,
            },
            limit: {
              type: "integer",
              min: 1,
              max: MAX_RESULT_LIMIT,
              default: DEFAULT_RESULT_LIMIT,
              description: "How many matches to return",
            },
            json: {
              type: "boolean",
              description: "Emit machine-readable JSON",
            },
          },
          run(input, ctx) {
            const query = input.positionals.query.join(" ").trim();
            if (!query) throw new CliError("search requires a query");
            const { scope, limit } = input.options;
            const memories = store.search(query, scope, ctx.projectId, limit);
            return {
              exitCode: 0,
              stdout: input.options.json
                ? jsonOutput({
                    ok: true,
                    query,
                    scope,
                    memories: memories.map(toMemorySummary),
                  })
                : memories
                    .map((memory) => displayMemory(memory, false))
                    .join("\n") || "No matches.",
            };
          },
        }),
        get: cliCommand({
          summary: "Read one complete memory",
          positionals: [
            {
              name: "id-or-name",
              description: "Memory id or its unique name",
              required: true,
            },
          ],
          options: {
            scope: {
              type: "enum",
              values: READ_SCOPES,
              default: "all",
              description: SCOPE_DESCRIPTION,
            },
            json: {
              type: "boolean",
              description: "Emit machine-readable JSON",
            },
          },
          run(input, ctx) {
            const idOrName = input.positionals["id-or-name"];
            const memory = store.get(
              idOrName,
              input.options.scope,
              ctx.projectId,
            );
            if (!memory) {
              throw new CliError(
                `memory "${idOrName}" was not found in the current scope`,
              );
            }
            return {
              exitCode: 0,
              stdout: input.options.json
                ? jsonOutput({ ok: true, memory })
                : displayMemory(memory, true),
            };
          },
        }),
        add: cliCommand({
          summary: "Save a project or global memory",
          unexpectedPositionalHint:
            "memory text belongs in --details <TEXT>, not a bare argument",
          options: {
            scope: {
              type: "enum",
              values: ["project", "global"],
              required: true,
              description:
                "project for repository facts, global for user preferences",
            },
            name: {
              type: "string",
              required: true,
              placeholder: "NAME",
              aliases: ["title"],
              description:
                "Unique 1-80 character lowercase name (letters, digits, dots, underscores, hyphens)",
            },
            summary: {
              type: "string",
              required: true,
              placeholder: "TEXT",
              description: "One line retrieval summary, at most 400 characters",
            },
            details: {
              type: "string",
              required: true,
              placeholder: "TEXT",
              aliases: ["body", "text", "content"],
              description: "Full memory text, at most 16000 characters",
            },
            reason: {
              type: "string",
              required: true,
              placeholder: "TEXT",
              description:
                "Why this is worth remembering, at most 500 characters",
            },
            kind: {
              type: "enum",
              values: MEMORY_KINDS,
              default: "fact",
              aliases: ["type"],
              description: "What kind of memory this is",
            },
            tag: {
              type: "string",
              repeatable: true,
              split: ",",
              placeholder: "TAG",
              aliases: ["tags"],
              description:
                "Lowercase tag; repeat or pass a comma-separated list, at most 20",
            },
            importance: {
              type: "integer",
              min: 0,
              max: 100,
              default: 50,
              description: "Ranking weight for the injected catalog",
            },
            pinned: {
              type: "boolean",
              description: "Keep this memory at the top of the catalog",
            },
            json: {
              type: "boolean",
              description: "Emit machine-readable JSON",
            },
          },
          run(input, ctx) {
            const memory = store.add({
              ...writeScope(input.options.scope, ctx.projectId),
              name: input.options.name,
              summary: input.options.summary,
              details: input.options.details,
              kind: input.options.kind,
              tags: input.options.tag,
              importance: input.options.importance,
              pinned: input.options.pinned,
              sourceThreadId: ctx.threadId ?? null,
              writeReason: input.options.reason,
            });
            return {
              exitCode: 0,
              stdout: input.options.json
                ? jsonOutput({ ok: true, memory })
                : `Saved ${memory.id} v${memory.version} (${memory.scope}/${memory.name}).`,
            };
          },
        }),
        update: cliCommand({
          summary: "Update a memory with version checking",
          positionals: [
            { name: "id", description: "Memory id", required: true },
          ],
          constraints: [
            {
              kind: "at-least-one",
              options: [
                "summary",
                "details",
                "kind",
                "tag",
                "importance",
                "pinned",
              ],
            },
          ],
          options: {
            "expected-version": {
              type: "integer",
              min: 1,
              max: MAX_EXPECTED_VERSION,
              required: true,
              description: "Version this update is based on",
            },
            reason: {
              type: "string",
              required: true,
              placeholder: "TEXT",
              description: "Why the memory changed, at most 500 characters",
            },
            summary: {
              type: "string",
              placeholder: "TEXT",
              description: "Replacement summary, at most 400 characters",
            },
            details: {
              type: "string",
              placeholder: "TEXT",
              aliases: ["body", "text", "content"],
              description: "Replacement details, at most 16000 characters",
            },
            kind: {
              type: "enum",
              values: MEMORY_KINDS,
              aliases: ["type"],
              description: "Replacement kind",
            },
            tag: {
              type: "string",
              repeatable: true,
              split: ",",
              placeholder: "TAG",
              aliases: ["tags"],
              description:
                "Replacement tags; repeat or pass a comma-separated list",
            },
            importance: {
              type: "integer",
              min: 0,
              max: 100,
              description: "Replacement ranking weight",
            },
            pinned: {
              type: "enum",
              values: ["true", "false"],
              description: "Pin or unpin the memory",
            },
            json: {
              type: "boolean",
              description: "Emit machine-readable JSON",
            },
          },
          run(input, ctx) {
            const tags = input.options.tag;
            const memory = store.update(
              input.positionals.id,
              {
                expectedVersion: input.options["expected-version"],
                summary: input.options.summary,
                details: input.options.details,
                kind: input.options.kind,
                tags: tags.length > 0 ? tags : undefined,
                importance: input.options.importance,
                pinned:
                  input.options.pinned === undefined
                    ? undefined
                    : input.options.pinned === "true",
                sourceThreadId: ctx.threadId ?? null,
                writeReason: input.options.reason,
              },
              ctx.projectId,
            );
            return {
              exitCode: 0,
              stdout: input.options.json
                ? jsonOutput({ ok: true, memory })
                : `Updated ${memory.id} to v${memory.version}.`,
            };
          },
        }),
        forget: cliCommand({
          summary: "Soft-delete a memory with version checking",
          positionals: [
            { name: "id", description: "Memory id", required: true },
          ],
          options: {
            "expected-version": {
              type: "integer",
              min: 1,
              max: MAX_EXPECTED_VERSION,
              required: true,
              description: "Version this deletion is based on",
            },
            reason: {
              type: "string",
              required: true,
              placeholder: "TEXT",
              description: "Why the memory is gone, at most 500 characters",
            },
            json: {
              type: "boolean",
              description: "Emit machine-readable JSON",
            },
          },
          run(input, ctx) {
            const memory = store.forget(
              input.positionals.id,
              input.options["expected-version"],
              input.options.reason,
              ctx.threadId ?? null,
              ctx.projectId,
            );
            return {
              exitCode: 0,
              stdout: input.options.json
                ? jsonOutput({
                    ok: true,
                    forgotten: { id: memory.id, version: memory.version },
                  })
                : `Forgot ${memory.id} at v${memory.version}.`,
            };
          },
        }),
        history: cliCommand({
          summary: "Show a memory's version history",
          positionals: [
            { name: "id", description: "Memory id", required: true },
          ],
          options: {
            limit: {
              type: "integer",
              min: 1,
              max: MAX_RESULT_LIMIT,
              default: DEFAULT_RESULT_LIMIT,
              description: "How many versions to show, newest first",
            },
            json: {
              type: "boolean",
              description: "Emit machine-readable JSON",
            },
          },
          run(input, ctx) {
            const id = input.positionals.id;
            const history = store.history(
              id,
              ctx.projectId,
              input.options.limit,
            );
            if (history.length === 0) {
              throw new CliError(`memory history for "${id}" was not found`);
            }
            return {
              exitCode: 0,
              stdout: input.options.json
                ? jsonOutput({ ok: true, id, history })
                : jsonOutput(history),
            };
          },
        }),
      },
    }),
  );
}
