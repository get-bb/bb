import { eq, getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createThreadSection, threads } from "@bb/db";
import {
  expectCachedReadsMatchUncachedBuilds,
  PLUGIN_ID,
  type ChangeContext,
} from "../helpers/thread-derived-cache-table.js";
import {
  seedEnvironment,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";

type ThreadRow = typeof threads.$inferSelect;

type ColumnChange<K extends keyof ThreadRow> =
  | ((context: ChangeContext) => Pick<ThreadRow, K>)
  | { excluded: string };

const LATER = 1_900_000_000_000;

function otherThreadId({ fixture, harness }: ChangeContext): string {
  return seedThread(harness.deps, { projectId: fixture.projectId }).id;
}

const THREAD_COLUMN_CHANGES: {
  [K in keyof ThreadRow]-?: ColumnChange<K>;
} = {
  id: { excluded: "the thread's identity; another id is another thread" },
  projectId: ({ fixture, harness }) => ({
    projectId: seedProjectWithSource(harness.deps, {
      hostId: fixture.hostId,
      name: "Other project",
      path: "/tmp/other-project",
    }).project.id,
  }),
  environmentId: ({ fixture, harness }) => ({
    environmentId: seedEnvironment(harness.deps, {
      hostId: fixture.hostId,
      projectId: fixture.projectId,
      path: "/tmp/other-environment",
    }).id,
  }),
  providerId: () => ({ providerId: "codex" }),
  modelOverride: () => ({ modelOverride: "gpt-5-mini" }),
  reasoningLevelOverride: () => ({ reasoningLevelOverride: "high" }),
  title: () => ({ title: "Renamed thread" }),
  titleFallback: () => ({ titleFallback: "Renamed fallback" }),
  sectionId: ({ harness }) => ({
    sectionId: createThreadSection(harness.db, harness.hub, {
      name: "Section",
    }).section.id,
  }),
  status: () => ({ status: "error" }),
  statusChangedAt: () => ({ statusChangedAt: LATER }),
  startupContext: () => ({ startupContext: JSON.stringify({ kind: "test" }) }),
  parentThreadId: (context) => ({ parentThreadId: otherThreadId(context) }),
  lifecycleOwnerThreadId: (context) => ({
    lifecycleOwnerThreadId: otherThreadId(context),
  }),
  sourceThreadId: (context) => ({ sourceThreadId: otherThreadId(context) }),
  originKind: () => ({ originKind: "fork" }),
  originPluginId: () => ({ originPluginId: PLUGIN_ID }),
  visibility: () => ({ visibility: "hidden" }),
  parentNotifications: () => ({ parentNotifications: "off" }),
  archivedAt: () => ({ archivedAt: LATER }),
  pinnedAt: () => ({ pinnedAt: LATER }),
  pinSortKey: () => ({ pinSortKey: "a0" }),
  deletedAt: () => ({ deletedAt: LATER }),
  storageDeletedAt: () => ({ storageDeletedAt: LATER }),
  lastReadAt: () => ({ lastReadAt: LATER }),
  latestAttentionAt: () => ({ latestAttentionAt: LATER }),
  createdAt: () => ({ createdAt: LATER }),
  updatedAt: () => ({ updatedAt: LATER }),
};

const COLUMN_ROWS = Object.keys(THREAD_COLUMN_CHANGES).map((column) => ({
  column,
}));

function changeColumn(column: keyof ThreadRow, context: ChangeContext): void {
  const change = THREAD_COLUMN_CHANGES[column];
  if ("excluded" in change) return;
  const values = change(context);
  const before = context.harness.db
    .select()
    .from(threads)
    .where(eq(threads.id, context.fixture.threadId))
    .get();
  expect({ ...before, ...values }).not.toEqual(before);
  context.harness.db
    .update(threads)
    .set(values)
    .where(eq(threads.id, context.fixture.threadId))
    .run();
}

function isColumn(column: string): column is keyof ThreadRow {
  return column in THREAD_COLUMN_CHANGES;
}

describe("thread-derived caches serve what an uncached build would after a thread column changes", () => {
  it("has a change or an exclusion for every threads column", () => {
    expect(Object.keys(getTableColumns(threads)).sort()).toEqual(
      Object.keys(THREAD_COLUMN_CHANGES).sort(),
    );
  });

  it.each(
    COLUMN_ROWS.filter(({ column }) => {
      if (!isColumn(column)) return false;
      return !("excluded" in THREAD_COLUMN_CHANGES[column]);
    }),
  )("the $column column", ({ column }) =>
    expectCachedReadsMatchUncachedBuilds(
      (context) => {
        if (!isColumn(column)) throw new Error(`unknown column ${column}`);
        changeColumn(column, context);
      },
      { changesOutput: false },
    ),
  );
});
