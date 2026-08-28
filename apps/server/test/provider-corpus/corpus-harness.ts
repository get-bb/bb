import fs from "node:fs";
import path from "node:path";
import {
  createConnection,
  createProject,
  getLatestThreadSequence,
  getThread,
  migrate,
  noopNotifier,
  threads,
  upsertHost,
} from "@bb/db";
import type { DbConnection } from "@bb/db";
import { defaultFeatureFlags } from "@bb/domain";
import type { Thread } from "@bb/domain";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import type { CorpusThread } from "@bb/test-helpers";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { resolveRepoRelativeFile } from "./env-file-path.js";
import {
  THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT,
  buildThreadTimelineWithProfile,
  type ThreadTimelineBuildProfile,
} from "../../src/services/threads/timeline.js";
import type { ThreadTimelinePageRequest } from "../../src/services/threads/timeline-pagination.js";
import { resolveProviderPlanCommand } from "../../src/services/providers/provider-plan-command.js";
import type { ProviderRegistryService } from "../../src/services/providers/provider-registry.js";
import { previewTimelineResponseOutputs } from "../../src/services/threads/timeline-output-preview.js";
import {
  DEFAULT_MAX_INLINE_OUTPUT_CHARS,
  truncateTimelineResponseOutputs,
} from "../../src/services/threads/timeline-output-truncation.js";

export const SNAPSHOT_MODE_ENV = "BB_PROVIDER_CORPUS_SNAPSHOT";

export const SNAPSHOT_ROWS_DIR_ENV = "BB_PROVIDER_CORPUS_SNAPSHOT_DIR";

export const ALLOWLIST_FILE_ENV = "BB_PROVIDER_CORPUS_ALLOWLIST";

export function resolveSnapshotRowsDir(
  snapshotsDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env[SNAPSHOT_ROWS_DIR_ENV];
  return value === undefined || value === ""
    ? path.join(snapshotsDir, "rows")
    : path.resolve(value);
}

export type SnapshotMode = "write" | "compare";

export function resolveSnapshotMode(
  env: NodeJS.ProcessEnv = process.env,
): SnapshotMode {
  const value = env[SNAPSHOT_MODE_ENV];
  if (value === undefined || value === "" || value === "compare") {
    return "compare";
  }
  if (value === "write") {
    return "write";
  }
  throw new Error(
    `${SNAPSHOT_MODE_ENV} must be "write" or "compare" (got ${JSON.stringify(value)})`,
  );
}

export interface LoadedCorpusThread {
  db: DbConnection;
  thread: Thread;
  close(): void;
}

export function loadCorpusThreadIntoDb(
  corpusThread: CorpusThread,
): LoadedCorpusThread {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "provider-corpus-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "provider-corpus",
    source: { type: "local_path", hostId: host.id, path: "/provider-corpus" },
  });
  const row = corpusThread.thread;
  db.transaction(
    (tx) => {
      tx.insert(threads)
        .values({
          id: row.id,
          projectId: project.id,
          environmentId: null,
          providerId: row.providerId,
          modelOverride: row.modelOverride,
          reasoningLevelOverride: row.reasoningLevelOverride,
          title: row.title,
          titleFallback: null,
          sectionId: null,
          status: row.status,
          parentThreadId: null,
          sourceThreadId: null,
          originKind: row.originKind,
          originPluginId: null,
          visibility: row.visibility,
          archivedAt: row.archivedAt,
          pinnedAt: null,
          pinSortKey: null,
          deletedAt: row.deletedAt,
          lastReadAt: null,
          latestAttentionAt: row.updatedAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })
        .run();
      for (const event of corpusThread.eventRows) {
        tx.run(
          sql`INSERT INTO events (id, thread_id, environment_id, scope_kind, turn_id, provider_thread_id, sequence, type, item_id, item_kind, parent_tool_call_id, data, created_at)
              VALUES (${event.id}, ${event.threadId}, ${null}, ${event.scopeKind}, ${event.turnId}, ${event.providerThreadId}, ${event.sequence}, ${event.type}, ${event.itemId}, ${event.itemKind}, ${event.parentToolCallId}, ${event.data}, ${event.createdAt})`,
        );
      }
    },
    { behavior: "immediate" },
  );
  const thread = getThread(db, row.id);
  if (!thread) {
    throw new Error(`Corpus thread ${row.id} did not load`);
  }
  return {
    db,
    thread,
    close: () => {
      db.$client.close();
    },
  };
}

export type TimelineVariant = "default" | "nested";

export const TIMELINE_VARIANTS: readonly TimelineVariant[] = [
  "default",
  "nested",
];

export interface BuiltTimelinePage {
  profile: ThreadTimelineBuildProfile;
  response: ThreadTimelineResponse;
}

export interface BuildRouteTimelinePageArgs {
  db: DbConnection;
  page: ThreadTimelinePageRequest;
  registry: ProviderRegistryService;
  thread: Thread;
  variant: TimelineVariant;
}

export function buildRouteTimelinePage(
  args: BuildRouteTimelinePageArgs,
): BuiltTimelinePage {
  const includeNestedRows = args.variant === "nested";
  const maxSeq = getLatestThreadSequence(args.db, {
    threadId: args.thread.id,
  });
  const { profile, response } = buildThreadTimelineWithProfile(
    args.db,
    args.thread,
    {
      eventBudget: defaultFeatureFlags.timelineWindowEventBudget,
      includeProviderUnhandledOperations: true,
      includeNestedRows,
      maxInlineOutputChars: DEFAULT_MAX_INLINE_OUTPUT_CHARS,
      maxSeq,
      page: args.page,
      providerDisplayName: args.registry.get(args.thread.providerId)?.info
        .displayName,
      planCommand: resolveProviderPlanCommand(
        args.registry,
        args.thread.providerId,
      ),
      summaryOnly: false,
    },
  );
  const truncated = truncateTimelineResponseOutputs(
    response,
    DEFAULT_MAX_INLINE_OUTPUT_CHARS,
  );
  return {
    profile,
    response: includeNestedRows
      ? truncated
      : previewTimelineResponseOutputs(truncated),
  };
}

export function latestTimelinePage(): ThreadTimelinePageRequest {
  return {
    kind: "latest",
    segmentLimit: THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT,
  };
}

export function buildAllRouteTimelinePages(
  args: Omit<BuildRouteTimelinePageArgs, "page">,
): BuiltTimelinePage[] {
  const pages: BuiltTimelinePage[] = [];
  const seenCursors = new Set<string>();
  let page = latestTimelinePage();
  for (;;) {
    const built = buildRouteTimelinePage({ ...args, page });
    pages.push(built);
    const { hasOlderRows, olderCursor } = built.response.timelinePage;
    if (!hasOlderRows || olderCursor === null) {
      return pages;
    }
    const cursorKey = `${olderCursor.anchorId}\0${olderCursor.anchorSeq}`;
    if (seenCursors.has(cursorKey)) {
      throw new Error(
        `Timeline pagination for ${args.thread.id} repeated cursor ${cursorKey}`,
      );
    }
    seenCursors.add(cursorKey);
    page = {
      kind: "older",
      segmentLimit: THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT,
      beforeCursor: olderCursor,
    };
  }
}

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | JsonObject;

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export function normalizeJson<Value>(value: Value | undefined): JsonValue {
  if (value == null) {
    return null;
  }
  return normalizeParsedJson(jsonValueSchema.parse(value));
}

function normalizeParsedJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeParsedJson(entry));
  }
  if (isJsonObject(value)) {
    const sorted: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry !== undefined) {
        sorted[key] = normalizeParsedJson(entry);
      }
    }
    return sorted;
  }
  return value;
}

export interface JsonDiff {
  pointer: string;
  expected: JsonValue | undefined;
  actual: JsonValue | undefined;
}

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return (
    value !== undefined &&
    value !== null &&
    value instanceof Object &&
    !Array.isArray(value)
  );
}

export function diffJson(
  expected: JsonValue | undefined,
  actual: JsonValue | undefined,
  pointer = "",
  out: JsonDiff[] = [],
): JsonDiff[] {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      diffJson(expected[index], actual[index], `${pointer}/${index}`, out);
    }
    return out;
  }
  if (isJsonObject(expected) && isJsonObject(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of [...keys].sort()) {
      diffJson(
        expected[key],
        actual[key],
        `${pointer}/${escapePointerSegment(key)}`,
        out,
      );
    }
    return out;
  }
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    out.push({ pointer, expected, actual });
  }
  return out;
}

export function unifiedJsonDiff(
  expected: JsonValue,
  actual: JsonValue,
  label: string,
  maxLines = 200,
): string {
  const expectedLines = diffLines(JSON.stringify(expected, null, 2));
  const actualLines = diffLines(JSON.stringify(actual, null, 2));
  if (expectedLines.join("\n") === actualLines.join("\n")) {
    return "";
  }

  const operations = buildDiffOperations(expectedLines, actualLines);
  const hunks = buildDiffHunks(operations);
  const lines = [
    `--- ${label} (snapshot)`,
    `+++ ${label} (current)`,
    ...hunks.flatMap((hunk) => [
      `@@ -${hunk.oldStart},${hunk.oldLength} +${hunk.newStart},${hunk.newLength} @@`,
      ...hunk.operations.map((operation) => {
        if (operation.kind === "equal") return ` ${operation.line}`;
        if (operation.kind === "delete") return `-${operation.line}`;
        return `+${operation.line}`;
      }),
    ]),
  ];
  if (lines.length + 1 <= maxLines) {
    return `${lines.join("\n")}\n`;
  }
  return `${lines.slice(0, maxLines).join("\n")}\n… ${lines.length + 1 - maxLines} more diff lines`;
}

type DiffOperation =
  | { kind: "delete"; line: string }
  | { kind: "equal"; line: string }
  | { kind: "insert"; line: string };

interface DiffHunk {
  newLength: number;
  newStart: number;
  oldLength: number;
  oldStart: number;
  operations: DiffOperation[];
}

function diffLines(value: string): string[] {
  return `${value}\n`.split("\n").slice(0, -1);
}

function buildDiffOperations(
  oldLines: readonly string[],
  newLines: readonly string[],
): DiffOperation[] {
  const maxEditDistance = oldLines.length + newLines.length;
  const trace: Map<number, number>[] = [];
  let frontier = new Map([[1, 0]]);

  for (
    let editDistance = 0;
    editDistance <= maxEditDistance;
    editDistance += 1
  ) {
    trace.push(new Map(frontier));
    const nextFrontier = new Map<number, number>();
    for (
      let diagonal = -editDistance;
      diagonal <= editDistance;
      diagonal += 2
    ) {
      const down =
        diagonal === -editDistance ||
        (diagonal !== editDistance &&
          (frontier.get(diagonal - 1) ?? 0) <
            (frontier.get(diagonal + 1) ?? 0));
      let oldIndex = down
        ? (frontier.get(diagonal + 1) ?? 0)
        : (frontier.get(diagonal - 1) ?? 0) + 1;
      let newIndex = oldIndex - diagonal;

      while (
        oldIndex < oldLines.length &&
        newIndex < newLines.length &&
        oldLines[oldIndex] === newLines[newIndex]
      ) {
        oldIndex += 1;
        newIndex += 1;
      }
      nextFrontier.set(diagonal, oldIndex);

      if (oldIndex >= oldLines.length && newIndex >= newLines.length) {
        return backtrackDiffOperations(
          trace,
          oldLines,
          newLines,
          editDistance,
          oldIndex,
          newIndex,
        );
      }
    }
    frontier = nextFrontier;
  }

  throw new Error("Could not build a unified JSON diff");
}

function backtrackDiffOperations(
  trace: readonly Map<number, number>[],
  oldLines: readonly string[],
  newLines: readonly string[],
  editDistance: number,
  oldIndex: number,
  newIndex: number,
): DiffOperation[] {
  const operations: DiffOperation[] = [];
  for (let distance = editDistance; distance >= 0; distance -= 1) {
    const diagonal = oldIndex - newIndex;
    const frontier = trace[distance];
    const down =
      diagonal === -distance ||
      (diagonal !== distance &&
        (frontier?.get(diagonal - 1) ?? 0) <
          (frontier?.get(diagonal + 1) ?? 0));
    const previousDiagonal = down ? diagonal + 1 : diagonal - 1;
    const previousOldIndex =
      distance === 0 ? 0 : (frontier?.get(previousDiagonal) ?? 0);
    const previousNewIndex =
      distance === 0 ? 0 : previousOldIndex - previousDiagonal;

    while (oldIndex > previousOldIndex && newIndex > previousNewIndex) {
      operations.push({ kind: "equal", line: oldLines[oldIndex - 1] ?? "" });
      oldIndex -= 1;
      newIndex -= 1;
    }

    if (distance === 0) break;
    if (oldIndex === previousOldIndex) {
      operations.push({ kind: "insert", line: newLines[newIndex - 1] ?? "" });
      newIndex -= 1;
    } else {
      operations.push({ kind: "delete", line: oldLines[oldIndex - 1] ?? "" });
      oldIndex -= 1;
    }
  }
  return operations.reverse();
}

function buildDiffHunks(operations: readonly DiffOperation[]): DiffHunk[] {
  const changedIndexes = operations.flatMap((operation, index) =>
    operation.kind === "equal" ? [] : [index],
  );
  const hunks: DiffHunk[] = [];
  let changedIndex = 0;
  while (changedIndex < changedIndexes.length) {
    const firstChange = changedIndexes[changedIndex] ?? 0;
    let start = Math.max(0, firstChange - 3);
    let end = Math.min(operations.length, firstChange + 4);
    changedIndex += 1;
    while (changedIndex < changedIndexes.length) {
      const nextChange = changedIndexes[changedIndex] ?? operations.length;
      if (nextChange > end + 3) break;
      end = Math.min(operations.length, nextChange + 4);
      changedIndex += 1;
    }
    const oldBefore = operations
      .slice(0, start)
      .filter((operation) => operation.kind !== "insert").length;
    const newBefore = operations
      .slice(0, start)
      .filter((operation) => operation.kind !== "delete").length;
    const hunkOperations = operations.slice(start, end);
    const oldLength = hunkOperations.filter(
      (operation) => operation.kind !== "insert",
    ).length;
    const newLength = hunkOperations.filter(
      (operation) => operation.kind !== "delete",
    ).length;
    hunks.push({
      newLength,
      newStart: newLength === 0 ? newBefore : newBefore + 1,
      oldLength,
      oldStart: oldLength === 0 ? oldBefore : oldBefore + 1,
      operations: hunkOperations,
    });
  }
  return hunks;
}

const allowlistScopeSchema = z.union([
  z.object({ threadId: z.string().min(1) }),
  z.object({ provider: z.string().min(1) }),
  z.object({ "*": z.literal(true) }),
]);

const allowlistEntrySchema = z
  .object({
    path: z.string().min(1),
    pr: z.string().regex(/^#\d+$/),
    reason: z.string().min(1),
  })
  .and(allowlistScopeSchema);

export type AllowlistEntry = z.infer<typeof allowlistEntrySchema>;

export const allowlistSchema = z.array(allowlistEntrySchema);

export function describeAllowlistEntry(entry: AllowlistEntry): string {
  const scope =
    "threadId" in entry
      ? `thread ${entry.threadId}`
      : "provider" in entry
        ? `provider ${entry.provider}`
        : "all threads";
  return `${scope} ${entry.path} (${entry.pr}: ${entry.reason})`;
}

function allowlistScopeMatches(
  entry: AllowlistEntry,
  target: { provider: string; threadId: string },
): boolean {
  if ("threadId" in entry) {
    return entry.threadId === target.threadId;
  }
  if ("provider" in entry) {
    return entry.provider === target.provider;
  }
  return true;
}

function globSegmentsMatch(
  pattern: readonly string[],
  segments: readonly string[],
): boolean {
  if (pattern.length === 0) {
    return segments.length === 0;
  }
  const [head, ...rest] = pattern;
  if (head === "**") {
    for (let skip = 0; skip <= segments.length; skip += 1) {
      if (globSegmentsMatch(rest, segments.slice(skip))) {
        return true;
      }
    }
    return false;
  }
  if (segments.length === 0) {
    return false;
  }
  if (head !== "*" && head !== segments[0]) {
    return false;
  }
  return globSegmentsMatch(rest, segments.slice(1));
}

export function allowlistPathMatches(
  pattern: string,
  pointer: string,
): boolean {
  const patternSegments = pattern.split("/").slice(1);
  const pointerSegments = pointer.split("/").slice(1);
  return globSegmentsMatch(patternSegments, pointerSegments);
}

export interface AllowlistMatchResult {
  allowed: JsonDiff[];
  unallowed: JsonDiff[];
  usedEntryIndexes: Set<number>;
}

export function applyAllowlist(
  entries: readonly AllowlistEntry[],
  target: { provider: string; threadId: string },
  diffs: readonly JsonDiff[],
): AllowlistMatchResult {
  const allowed: JsonDiff[] = [];
  const unallowed: JsonDiff[] = [];
  const usedEntryIndexes = new Set<number>();
  for (const diff of diffs) {
    let covered = false;
    entries.forEach((entry, index) => {
      if (
        allowlistScopeMatches(entry, target) &&
        allowlistPathMatches(entry.path, diff.pointer)
      ) {
        covered = true;
        usedEntryIndexes.add(index);
      }
    });
    (covered ? allowed : unallowed).push(diff);
  }
  return { allowed, unallowed, usedEntryIndexes };
}

function readAllowlistFile(allowlistPath: string): AllowlistEntry[] {
  return allowlistSchema.parse(
    JSON.parse(fs.readFileSync(allowlistPath, "utf8")),
  );
}

export function readAllowlist(
  snapshotsDir: string,
  env: NodeJS.ProcessEnv = process.env,
): AllowlistEntry[] {
  const entries: AllowlistEntry[] = [];
  const sharedPath = path.join(snapshotsDir, "allowlist.json");
  if (fs.existsSync(sharedPath)) {
    entries.push(...readAllowlistFile(sharedPath));
  }
  const extraPath = env[ALLOWLIST_FILE_ENV];
  if (extraPath !== undefined && extraPath !== "") {
    entries.push(
      ...readAllowlistFile(
        resolveRepoRelativeFile(ALLOWLIST_FILE_ENV, extraPath),
      ),
    );
  }
  return entries;
}

export function percentile(
  values: readonly number[],
  fraction: number,
): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  const value = sorted[index];
  if (value === undefined) {
    throw new Error("percentile index out of range");
  }
  return value;
}

export function formatMarkdownTable(
  header: readonly string[],
  rows: readonly (readonly (string | number)[])[],
): string {
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(String).join(" | ")} |`),
  ];
  return lines.join("\n");
}
