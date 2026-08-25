import { and, desc, eq, isNull } from "drizzle-orm";
import {
  PROMPT_HISTORY_ENTRY_LIMIT,
  type PromptHistoryScope,
  type PromptInput,
} from "@bb/domain";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import { promptHistoryEntries, threads } from "../schema.js";
import { createPromptHistoryEntryId } from "../ids.js";

export interface StoredPromptHistoryEntryRow {
  createdAt: number;
  id: string;
  input: string;
  requestSequence: number;
  threadId: string;
}

export interface CreatePromptHistoryEntryInput {
  createdAt?: number;
  input: PromptInput[];
  projectId: string;
  requestSequence: number;
  scope: PromptHistoryScope;
  threadId: string;
}

export interface ListStoredPromptHistoryArgs {
  limit: number;
}

export interface ListStoredProjectPromptHistoryArgs
  extends ListStoredPromptHistoryArgs {
  projectId: string;
}

export interface ListStoredThreadPromptHistoryArgs
  extends ListStoredPromptHistoryArgs {
  threadId: string;
}

function rawPromptHistoryRowLimit(limit: number): number {
  // Fetch one extra visible window to absorb consecutive duplicate collapse
  // without falling back to OFFSET paging.
  return Math.min(
    PROMPT_HISTORY_ENTRY_LIMIT * 2,
    limit + PROMPT_HISTORY_ENTRY_LIMIT,
  );
}

export function createPromptHistoryEntry(
  db: DbQueryConnection,
  input: CreatePromptHistoryEntryInput,
): StoredPromptHistoryEntryRow {
  const createdAt = input.createdAt ?? Date.now();
  return db
    .insert(promptHistoryEntries)
    .values({
      id: createPromptHistoryEntryId(),
      projectId: input.projectId,
      threadId: input.threadId,
      scope: input.scope,
      requestSequence: input.requestSequence,
      input: JSON.stringify(input.input),
      createdAt,
    })
    .returning({
      createdAt: promptHistoryEntries.createdAt,
      id: promptHistoryEntries.id,
      input: promptHistoryEntries.input,
      requestSequence: promptHistoryEntries.requestSequence,
      threadId: promptHistoryEntries.threadId,
    })
    .get();
}

export function listStoredProjectPromptHistoryRows(
  db: DbQueryConnection,
  args: ListStoredProjectPromptHistoryArgs,
): StoredPromptHistoryEntryRow[] {
  return db
    .select({
      createdAt: promptHistoryEntries.createdAt,
      id: promptHistoryEntries.id,
      input: promptHistoryEntries.input,
      requestSequence: promptHistoryEntries.requestSequence,
      threadId: promptHistoryEntries.threadId,
    })
    .from(promptHistoryEntries)
    .innerJoin(threads, eq(threads.id, promptHistoryEntries.threadId))
    .where(
      and(
        eq(promptHistoryEntries.projectId, args.projectId),
        eq(promptHistoryEntries.scope, "project"),
        isNull(threads.deletedAt),
      ),
    )
    .orderBy(
      desc(promptHistoryEntries.createdAt),
      desc(promptHistoryEntries.requestSequence),
      desc(promptHistoryEntries.id),
    )
    .limit(rawPromptHistoryRowLimit(args.limit))
    .all();
}

/**
 * Newest prompt-history entries kept per `(thread, scope)`. Four times the
 * largest read window (`PROMPT_HISTORY_ENTRY_LIMIT * 2`), so capping never
 * changes what the history pickers can page to. Retention policy — revisit
 * deliberately, not incidentally.
 */
export const PROMPT_HISTORY_KEEP_PER_SCOPE = 200;
export const DEFAULT_PROMPT_HISTORY_CAP_SCOPE_BATCH_SIZE = 100;

export interface CapPromptHistoryEntriesArgs {
  keepPerScope: number;
  maxScopes: number;
}

export interface CapPromptHistoryEntriesResult {
  deleted: number;
  scopesCapped: number;
}

interface OverCapPromptHistoryScopeRow {
  scope: PromptHistoryScope;
  threadId: string;
}

type OverCapScopeParameters = [number, number];
type CapDeleteParameters = [string, PromptHistoryScope, number];

/**
 * Caps stored prompt history at the newest `keepPerScope` entries per
 * `(thread, scope)` pair — the exact granularity the history reads use — so a
 * long-lived thread stops accumulating a second full copy of every prompt.
 * Deletion order matches the read order (newest by `created_at`,
 * `request_sequence`, `id`), so the kept window is exactly what the reads
 * page over. Bounded per pass by `maxScopes`; the sweep converges across
 * passes.
 */
export function capPromptHistoryEntries(
  db: DbConnection,
  args: CapPromptHistoryEntriesArgs,
): CapPromptHistoryEntriesResult {
  const overCapScopes = db.$client
    .prepare<OverCapScopeParameters, OverCapPromptHistoryScopeRow>(
      `
        SELECT thread_id AS threadId, scope
        FROM prompt_history_entries
        GROUP BY thread_id, scope
        HAVING COUNT(*) > ?
        LIMIT ?
      `,
    )
    .all(args.keepPerScope, args.maxScopes);

  let deleted = 0;
  for (const overCapScope of overCapScopes) {
    const result = db.$client
      .prepare<CapDeleteParameters>(
        `
          DELETE FROM prompt_history_entries
          WHERE id IN (
            SELECT id
            FROM prompt_history_entries
            WHERE thread_id = ?
              AND scope = ?
            ORDER BY created_at DESC, request_sequence DESC, id DESC
            LIMIT -1 OFFSET ?
          )
        `,
      )
      .run(overCapScope.threadId, overCapScope.scope, args.keepPerScope);
    deleted += result.changes;
  }

  return { deleted, scopesCapped: overCapScopes.length };
}

export function listStoredThreadPromptHistoryRows(
  db: DbQueryConnection,
  args: ListStoredThreadPromptHistoryArgs,
): StoredPromptHistoryEntryRow[] {
  return db
    .select({
      createdAt: promptHistoryEntries.createdAt,
      id: promptHistoryEntries.id,
      input: promptHistoryEntries.input,
      requestSequence: promptHistoryEntries.requestSequence,
      threadId: promptHistoryEntries.threadId,
    })
    .from(promptHistoryEntries)
    .where(
      and(
        eq(promptHistoryEntries.threadId, args.threadId),
        eq(promptHistoryEntries.scope, "thread"),
      ),
    )
    .orderBy(
      desc(promptHistoryEntries.createdAt),
      desc(promptHistoryEntries.requestSequence),
      desc(promptHistoryEntries.id),
    )
    .limit(rawPromptHistoryRowLimit(args.limit))
    .all();
}
