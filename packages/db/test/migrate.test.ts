import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publishedMigrationWhensByTag } from "../src/migration-history.js";
import {
  createConnection,
  migrate,
  type DbConnection,
  type MigrationWarningLogger,
} from "../src/index.js";

type InsertMigrationParameters = [string, number];
type DeleteMigrationParameters = [number];
type DeleteMigrationsParameters = [number, number, number, number, number];
type TableNameParameters = [string];
type QueuedMessageMigrationInsertParameters = [string, string, number, number];
type ProjectSortKeyMigrationInsertParameters = [string, string, number, number];
type ThreadSortKeyMigrationInsertParameters = [string, string, string, number];
type LegacyNudgeMigrationInsertParameters = [
  string,
  string,
  string,
  string,
  string,
  string,
  number,
  number,
  number | null,
  number,
  number,
];

interface IndexNameRow {
  name: string;
}

interface TableNameRow {
  name: string;
}

interface MigrationCreatedAtRow {
  createdAt: number;
}

interface MigrationCountRow {
  count: number;
}

interface LatestMigrationCreatedAtRow {
  createdAt: number | null;
}

interface MigratedQueuedMessageRow {
  id: string;
  sortKey: string;
  threadId: string;
}

interface MigratedProjectRow {
  id: string;
  sortKey: string;
}

interface MigratedThreadSortKeyRow {
  id: string;
  sortKey: string | null;
}

interface MigratedManagerCleanupDefaultRow {
  model: string;
  permissionMode: string;
  providerId: string;
  reasoningLevel: string;
  serviceTier: string;
}

interface MigratedManagerCleanupThreadRow {
  id: string;
  parentThreadId: string | null;
}

interface MigratedThreadScheduleRow {
  createdAt: number;
  cron: string;
  enabled: number;
  id: string;
  kind: string;
  lastFiredAt: number | null;
  name: string;
  nextFireAt: number;
  projectId: string;
  prompt: string;
  threadId: string;
  timezone: string;
  updatedAt: number;
}

interface MigratedTerminalSessionRow {
  id: string;
  threadId: string;
  environmentId: string;
  hostId: string;
  daemonSessionId: string | null;
  title: string;
  initialCwd: string;
  cols: number;
  rows: number;
  status: string;
  exitCode: number | null;
  closeReason: string | null;
  createdAt: number;
  updatedAt: number;
  lastUserInputAt: number | null;
}

interface OperationBackfillProjectRow {
  deletedAt: number | null;
}

interface OperationBackfillEnvironmentRow {
  status: string;
}

interface OperationBackfillThreadRow {
  status: string;
}

interface MigratedEventRow {
  createdAt: number;
  data: string;
  environmentId: string | null;
  id: string;
  itemId: string | null;
  itemKind: string | null;
  providerThreadId: string | null;
  scopeKind: string;
  sequence: number;
  threadId: string;
  turnId: string | null;
  type: string;
}

interface MigratedEventDataRow {
  data: string;
}

interface MigratedPendingInteractionStatusRow {
  id: string;
  resolvedAt: number | null;
  status: string;
  statusReason: string | null;
  updatedAt: number;
}

interface MigratedPendingInteractionEventStatusRow {
  id: string;
  status: string | null;
  statusReason: string | null;
}

interface PersonalProjectMigrationRow {
  count: number;
}

interface TableInfoRow {
  name: string;
  notnull: number;
}

interface ReadIndexNamesArgs {
  db: DbConnection;
  tableName: string;
}

interface ReplaceAppliedMigrationHashArgs {
  db: DbConnection;
  createdAt: number;
  hash: string;
}

interface RunMigrationFileArgs {
  db: DbConnection;
  migrationPath: string;
}

interface SeedPre0017TerminalSessionMigrationArgs {
  db: DbConnection;
}

interface SeedEventLargeValueBackfillEventArgs {
  createdAt: number;
  data: string;
  id: string;
  itemId: string;
  itemKind: string;
  sequence: number;
  type?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function requirePublishedMigrationWhen(tag: string): number {
  const when = publishedMigrationWhensByTag.get(tag);
  if (when === undefined) {
    throw new Error(`No published migration timestamp for ${tag}`);
  }

  return when;
}

const baselineWhen = requirePublishedMigrationWhen("0000_baseline");
const publishedTerminalSessionUserInputWhen = requirePublishedMigrationWhen(
  "0001_terminal_session_user_input",
);
const closedSessionPruneIndexesWhen = requirePublishedMigrationWhen(
  "0002_closed_session_prune_indexes",
);
const threadDynamicContextFileStatesWhen = 1779139400002;
const commandLookupIndexesWhen = 1779943370189;
const threadPinningMigrationWhen = 1779990051923;
const threadSchedulesMigrationWhen = 1780614650350;
const threadScheduleKindDefaultMigrationWhen = 1780687798956;
const operationStateBackfillMigrationWhen = 1780687798957;
const eventProducerColumnsMigrationWhen = 1780692763264;
const terminalSessionRuntimeStateHonestyWhen = 1780718665310;
const hostDaemonSessionObservabilityMigrationWhen = 1780719536955;
const threadTypeRemovalMigrationWhen = 1780973302146;
const eventLargeValuesMigrationWhen = 1781403656069;
const eventLargeValuesRestoreMigrationWhen = 1781557200000;
const eventLargeValuesPreOptimizationHash =
  "bc111f5134183c37cf135af70231ec5a79823f9868818fdd8377e1ab3c05a23f";
const queuedMessageSortKeyMigrationPath = resolve(
  __dirname,
  "..",
  "drizzle",
  "0004_wild_justice.sql",
);
const sidebarOrderingMigrationPath = resolve(
  __dirname,
  "..",
  "drizzle",
  "0005_strong_exodus.sql",
);
const threadPinningMigrationPath = resolve(
  __dirname,
  "..",
  "drizzle",
  "0008_thread_pinning.sql",
);
const pendingInteractionSchemaHonestyMigrationPath = resolve(
  __dirname,
  "..",
  "drizzle",
  "0019_pending_interactions_schema_honesty.sql",
);
function closeConnection(db: DbConnection): void {
  db.$client.close();
}

function dropEnvironmentNameColumn(db: DbConnection): void {
  db.$client.prepare("ALTER TABLE environments DROP COLUMN name").run();
}

function dropEnvironmentDestroyAttemptIdColumn(db: DbConnection): void {
  db.$client
    .prepare("ALTER TABLE environments DROP COLUMN destroy_attempt_id")
    .run();
}

/**
 * cleanup_mode existed since the baseline and is dropped by 0033, so a forward
 * replay from before 0033 must first restore it for 0033's DROP COLUMN to apply
 * — the mirror of the post-ADD-COLUMN drops above.
 */
function restoreEnvironmentCleanupModeColumn(db: DbConnection): void {
  db.$client
    .prepare("ALTER TABLE environments ADD COLUMN cleanup_mode text")
    .run();
}

/**
 * cleanup_requested_at existed since the baseline and is dropped by 0035.
 * Tests that rewind migration history from a current schema need to restore it
 * so Drizzle can replay the historical DROP COLUMN migration.
 */
function restoreEnvironmentCleanupRequestedAtColumn(db: DbConnection): void {
  const columns = db.$client
    .prepare<[], TableInfoRow>("PRAGMA table_info(environments)")
    .all()
    .map((row) => row.name);
  if (!columns.includes("cleanup_requested_at")) {
    db.$client
      .prepare("ALTER TABLE environments ADD COLUMN cleanup_requested_at integer")
      .run();
  }
  db.$client
    .prepare(
      "CREATE INDEX IF NOT EXISTS environments_cleanup_requested_idx ON environments (cleanup_requested_at)",
    )
    .run();
}

/**
 * stop_requested_at existed since the baseline and is dropped by 0034, so a
 * forward replay from before 0034 must first restore it for 0034's DROP COLUMN
 * to apply — and the legacy thread_operations stop backfill in migrate.ts
 * writes it before the journal runs. Mirror of restoreEnvironmentCleanupModeColumn.
 */
function restoreThreadStopRequestedAtColumn(db: DbConnection): void {
  db.$client
    .prepare("ALTER TABLE threads ADD COLUMN stop_requested_at integer")
    .run();
}

function dropQueuedMessageSenderThreadIdColumn(db: DbConnection): void {
  db.$client
    .prepare("ALTER TABLE queued_thread_messages DROP COLUMN sender_thread_id")
    .run();
}

/** Tables created by migrations after 0023, dropped so migrate() re-applies. */
function dropPost0023Tables(db: DbConnection): void {
  for (const table of [
    "workflow_run_events",
    "workflow_run_operations",
    "workflow_runs",
    "project_workflow_policies",
    "system_experiments",
    "event_large_values",
  ]) {
    db.$client.prepare(`DROP TABLE IF EXISTS ${table}`).run();
  }
}

function restorePre0022ThreadTypeSchema(db: DbConnection): void {
  db.$client.exec(`
    ALTER TABLE project_execution_defaults
      ADD COLUMN thread_type text DEFAULT 'standard' NOT NULL;
    DROP INDEX project_execution_defaults_project_idx;
    CREATE UNIQUE INDEX project_execution_defaults_project_thread_type_idx
      ON project_execution_defaults (project_id, thread_type);
    CREATE INDEX project_execution_defaults_project_idx
      ON project_execution_defaults (project_id);

    ALTER TABLE threads ADD COLUMN type text DEFAULT 'standard' NOT NULL;
    ALTER TABLE threads ADD COLUMN sort_key text;
    CREATE INDEX threads_project_type_sort_idx
      ON threads (project_id, type, sort_key, id);
  `);
}

function readIndexNames(args: ReadIndexNamesArgs): string[] {
  return args.db.$client
    .prepare<TableNameParameters, IndexNameRow>(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
          AND tbl_name = ?
        ORDER BY name
      `,
    )
    .all(args.tableName)
    .map((row) => row.name);
}

function readTableNames(db: DbConnection): string[] {
  return db.$client
    .prepare<[], TableNameRow>(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name
      `,
    )
    .all()
    .map((row) => row.name);
}

function readLatestAppliedMigrationCreatedAt(db: DbConnection): number {
  const row = db.$client
    .prepare<[], LatestMigrationCreatedAtRow>(
      `
        SELECT MAX(created_at) AS createdAt
        FROM __drizzle_migrations
      `,
    )
    .get();
  const createdAt = row?.createdAt;
  if (typeof createdAt !== "number") {
    throw new Error("Expected at least one applied migration timestamp");
  }
  return createdAt;
}

function readAppliedMigrationCreatedAts(db: DbConnection): number[] {
  return db.$client
    .prepare<[], MigrationCreatedAtRow>(
      `
        SELECT created_at AS createdAt
        FROM __drizzle_migrations
        WHERE created_at IS NOT NULL
        ORDER BY created_at
      `,
    )
    .all()
    .map((row) => row.createdAt);
}

function replaceAppliedMigrationHash(
  args: ReplaceAppliedMigrationHashArgs,
): void {
  args.db.$client
    .prepare<DeleteMigrationParameters>(
      `
        DELETE FROM __drizzle_migrations
        WHERE created_at = ?
      `,
    )
    .run(args.createdAt);
  args.db.$client
    .prepare<InsertMigrationParameters>(
      `
        INSERT INTO __drizzle_migrations (hash, created_at)
        VALUES (?, ?)
      `,
    )
    .run(args.hash, args.createdAt);
}

function runMigrationFile(args: RunMigrationFileArgs): void {
  const migrationSql = readFileSync(args.migrationPath, "utf-8");

  const statements = migrationSql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    args.db.$client.exec(statement);
  }
}

function markEventLargeValuesMigrationUnapplied(db: DbConnection): void {
  db.$client.prepare("DROP TABLE IF EXISTS event_large_values").run();
  restoreEnvironmentCleanupModeColumn(db);
  restoreEnvironmentCleanupRequestedAtColumn(db);
  restoreThreadStopRequestedAtColumn(db);
  db.$client
    .prepare<DeleteMigrationParameters>(
      `
        DELETE FROM __drizzle_migrations
        WHERE created_at >= ?
      `,
    )
    .run(eventLargeValuesMigrationWhen);
}

function seedEventLargeValueBackfillThread(db: DbConnection): void {
  db.$client.exec(`
    INSERT INTO projects (id, name, created_at, updated_at)
    VALUES ('proj_large_value_backfill', 'Large Value Backfill', 1000, 1000);

    INSERT INTO threads (
      id,
      project_id,
      provider_id,
      latest_attention_at,
      created_at,
      updated_at
    )
    VALUES (
      'thr_large_value_backfill',
      'proj_large_value_backfill',
      'codex',
      1000,
      1000,
      1000
    );
  `);
}

function seedEventLargeValueBackfillEvent(
  db: DbConnection,
  args: SeedEventLargeValueBackfillEventArgs,
): void {
  db.$client
    .prepare<[string, number, string, string, string, string, number]>(
      `
        INSERT INTO events (
          id,
          thread_id,
          scope_kind,
          turn_id,
          sequence,
          type,
          item_id,
          item_kind,
          data,
          created_at
        )
        VALUES (
          ?,
          'thr_large_value_backfill',
          'turn',
          'turn_large_value_backfill',
          ?,
          ?,
          ?,
          ?,
          ?,
          ?
        )
      `,
    )
    .run(
      args.id,
      args.sequence,
      args.type ?? "item/completed",
      args.itemId,
      args.itemKind,
      args.data,
      args.createdAt,
    );
}

function readMigratedEventData(db: DbConnection, eventId: string): string {
  const row = db.$client
    .prepare<[string], MigratedEventDataRow>(
      `
        SELECT data
        FROM events
        WHERE id = ?
      `,
    )
    .get(eventId);
  if (!row) {
    throw new Error(`Expected migrated event ${eventId}`);
  }
  return row.data;
}

function seedPre0017TerminalSessionMigration(
  args: SeedPre0017TerminalSessionMigrationArgs,
): void {
  args.db.$client.pragma("foreign_keys = OFF");
  try {
    args.db.$client.exec(`
      DROP TABLE terminal_sessions;
      CREATE TABLE terminal_sessions (
        id text PRIMARY KEY NOT NULL,
        thread_id text NOT NULL,
        environment_id text NOT NULL,
        host_id text NOT NULL,
        daemon_session_id text,
        title text NOT NULL,
        initial_cwd text NOT NULL,
        current_cwd text,
        cols integer NOT NULL,
        rows integer NOT NULL,
        status text NOT NULL,
        exit_code integer,
        close_reason text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        last_user_input_at integer,
        last_connected_at integer,
        exited_at integer,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE cascade,
        FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE cascade,
        FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE cascade,
        FOREIGN KEY (daemon_session_id) REFERENCES host_daemon_sessions(id) ON DELETE set null
      );
      CREATE INDEX terminal_sessions_thread_status_updated_idx
        ON terminal_sessions (thread_id, status, updated_at);
      CREATE INDEX terminal_sessions_environment_status_idx
        ON terminal_sessions (environment_id, status);
      CREATE INDEX terminal_sessions_host_status_idx
        ON terminal_sessions (host_id, status);
      CREATE INDEX terminal_sessions_daemon_session_idx
        ON terminal_sessions (daemon_session_id);
    `);
  } finally {
    args.db.$client.pragma("foreign_keys = ON");
  }

  args.db.$client.exec(`
    INSERT INTO hosts (id, name, type, created_at, updated_at)
    VALUES ('host_pre0017', 'pre-0017 host', 'persistent', 1000, 1000);

    INSERT INTO projects (id, name, created_at, updated_at)
    VALUES ('proj_pre0017', 'pre-0017 project', 1000, 1000);

    INSERT INTO environments (
      id,
      project_id,
      host_id,
      path,
      workspace_provision_type,
      status,
      created_at,
      updated_at
    )
    VALUES (
      'env_pre0017',
      'proj_pre0017',
      'host_pre0017',
      '/tmp/pre0017',
      'unmanaged',
      'ready',
      1000,
      1000
    );

    INSERT INTO threads (
      id,
      project_id,
      environment_id,
      provider_id,
      latest_attention_at,
      created_at,
      updated_at
    )
    VALUES (
      'thr_pre0017',
      'proj_pre0017',
      'env_pre0017',
      'codex',
      1000,
      1000,
      1000
    );

    INSERT INTO host_daemon_sessions (
      id,
      host_id,
      instance_id,
      host_name,
      host_type,
      data_dir,
      protocol_version,
      heartbeat_interval_ms,
      lease_timeout_ms,
      status,
      lease_expires_at,
      created_at,
      updated_at
    )
    VALUES (
      'sess_pre0017',
      'host_pre0017',
      'inst_pre0017',
      'pre-0017 host',
      'persistent',
      '/tmp/pre0017-data',
      32,
      10000,
      30000,
      'active',
      9000,
      1000,
      1000
    );

    INSERT INTO terminal_sessions (
      id,
      thread_id,
      environment_id,
      host_id,
      daemon_session_id,
      title,
      initial_cwd,
      current_cwd,
      cols,
      rows,
      status,
      exit_code,
      close_reason,
      created_at,
      updated_at,
      last_user_input_at,
      last_connected_at,
      exited_at
    )
    VALUES (
      'term_pre0017',
      'thr_pre0017',
      'env_pre0017',
      'host_pre0017',
      'sess_pre0017',
      'Terminal 1',
      '/tmp/pre0017',
      '/tmp/derived-runtime-cwd',
      120,
      40,
      'running',
      NULL,
      NULL,
      1100,
      1200,
      1300,
      1400,
      NULL
    );
  `);
}

function seedPre0014ThreadSchedulesSchema(db: DbConnection): void {
  db.$client.pragma("foreign_keys = OFF");
  try {
    db.$client.exec(`
      DROP TABLE thread_schedules;
      CREATE TABLE thread_schedules (
        id text PRIMARY KEY NOT NULL,
        project_id text NOT NULL,
        thread_id text NOT NULL,
        name text NOT NULL,
        enabled integer DEFAULT true NOT NULL,
        kind text DEFAULT 'cron' NOT NULL,
        cron text NOT NULL,
        timezone text NOT NULL,
        prompt text NOT NULL,
        next_fire_at integer NOT NULL,
        last_fired_at integer,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE cascade,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE cascade
      );
      CREATE INDEX thread_schedules_due_idx
        ON thread_schedules (enabled, next_fire_at);
      CREATE INDEX thread_schedules_project_idx
        ON thread_schedules (project_id);
      CREATE UNIQUE INDEX thread_schedules_thread_name_idx
        ON thread_schedules (thread_id, name);
    `);
  } finally {
    db.$client.pragma("foreign_keys = ON");
  }
}

function seedFailingPre0014ThreadSchedulesSchema(db: DbConnection): void {
  db.$client.pragma("foreign_keys = OFF");
  try {
    db.$client.exec(`
      DROP TABLE thread_schedules;
      CREATE TABLE thread_schedules (
        id text PRIMARY KEY NOT NULL,
        project_id text NOT NULL,
        thread_id text NOT NULL,
        name text NOT NULL,
        enabled integer DEFAULT true NOT NULL,
        kind text,
        cron text NOT NULL,
        timezone text NOT NULL,
        prompt text NOT NULL,
        next_fire_at integer NOT NULL,
        last_fired_at integer,
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      );
      CREATE INDEX thread_schedules_due_idx
        ON thread_schedules (enabled, next_fire_at);
      CREATE INDEX thread_schedules_project_idx
        ON thread_schedules (project_id);
      CREATE UNIQUE INDEX thread_schedules_thread_name_idx
        ON thread_schedules (thread_id, name);
      INSERT INTO thread_schedules (
        id,
        project_id,
        thread_id,
        name,
        enabled,
        kind,
        cron,
        timezone,
        prompt,
        next_fire_at,
        last_fired_at,
        created_at,
        updated_at
      )
      VALUES (
        'tsched_failing_0014',
        'proj_failing_0014',
        'thr_failing_0014',
        'Bad schedule',
        1,
        NULL,
        '* * * * *',
        'UTC',
        'Bad schedule prompt',
        1000,
        NULL,
        1000,
        1000
      );
    `);
  } finally {
    db.$client.pragma("foreign_keys = ON");
  }
}

function addPre0017TerminalRuntimeColumns(db: DbConnection): void {
  db.$client.exec(`
    ALTER TABLE terminal_sessions ADD COLUMN current_cwd text;
    ALTER TABLE terminal_sessions ADD COLUMN last_connected_at integer;
    ALTER TABLE terminal_sessions ADD COLUMN exited_at integer;
  `);
}

function runQueuedMessageSortKeyMigration(db: DbConnection): void {
  runMigrationFile({ db, migrationPath: queuedMessageSortKeyMigrationPath });
}

function runSidebarOrderingMigration(db: DbConnection): void {
  runMigrationFile({ db, migrationPath: sidebarOrderingMigrationPath });
}

function runThreadPinningMigration(db: DbConnection): void {
  runMigrationFile({ db, migrationPath: threadPinningMigrationPath });
}

function deleteDeferredCleanupMigrationRows(db: DbConnection): void {
  db.$client
    .prepare<DeleteMigrationsParameters>(
      `
        DELETE FROM __drizzle_migrations
        WHERE created_at IN (?, ?, ?, ?, ?)
      `,
    )
    .run(
      threadScheduleKindDefaultMigrationWhen,
      operationStateBackfillMigrationWhen,
      eventProducerColumnsMigrationWhen,
      terminalSessionRuntimeStateHonestyWhen,
      hostDaemonSessionObservabilityMigrationWhen,
    );
}

describe("migrate", () => {
  it("provisions the singleton personal project", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);

      const personalProject = db.$client
        .prepare<[], PersonalProjectMigrationRow>(
          `
            SELECT COUNT(*) AS count
            FROM projects
            WHERE id = 'proj_personal'
              AND kind = 'personal'
              AND name = 'Personal'
          `,
        )
        .get();
      expect(personalProject?.count).toBe(1);

      expect(() =>
        db.$client
          .prepare(
            `
              INSERT INTO projects (id, kind, name, sort_key, created_at, updated_at)
              VALUES ('proj_second_personal', 'personal', 'Second personal', 'V', 1, 1)
            `,
          )
          .run(),
      ).toThrow();
    } finally {
      closeConnection(db);
    }
  });

  it("removes manager thread type schema while preserving existing threads and schedules", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);
      restorePre0022ThreadTypeSchema(db);
      db.$client.exec(`
        INSERT INTO projects (id, name, created_at, updated_at)
        VALUES ('proj_manager_cleanup', 'Manager cleanup', 1000, 1000);

        INSERT INTO threads (
          id,
          project_id,
          provider_id,
          type,
          sort_key,
          title,
          status,
          latest_attention_at,
          created_at,
          updated_at
        )
        VALUES (
          'thr_former_manager',
          'proj_manager_cleanup',
          'codex',
          'manager',
          '0000000000000001',
          'Former manager',
          'idle',
          2000,
          2000,
          2000
        );

        INSERT INTO threads (
          id,
          project_id,
          provider_id,
          type,
          parent_thread_id,
          title,
          status,
          latest_attention_at,
          created_at,
          updated_at
        )
        VALUES (
          'thr_former_child',
          'proj_manager_cleanup',
          'codex',
          'standard',
          'thr_former_manager',
          'Former child',
          'idle',
          3000,
          3000,
          3000
        );

        INSERT INTO project_execution_defaults (
          project_id,
          provider_id,
          thread_type,
          model,
          service_tier,
          reasoning_level,
          permission_mode,
          updated_at
        )
        VALUES
          (
            'proj_manager_cleanup',
            'codex',
            'standard',
            'gpt-5',
            'default',
            'medium',
            'full',
            4000
          ),
          (
            'proj_manager_cleanup',
            'codex',
            'manager',
            'gpt-5.5',
            'default',
            'xhigh',
            'full',
            5000
          );

        INSERT INTO thread_schedules (
          id,
          project_id,
          thread_id,
          name,
          enabled,
          kind,
          cron,
          timezone,
          prompt,
          next_fire_at,
          created_at,
          updated_at
        )
        VALUES (
          'tsched_former_manager',
          'proj_manager_cleanup',
          'thr_former_manager',
          'Former manager schedule',
          1,
          'cron',
          '0 9 * * *',
          'UTC',
          'Continue scheduled work.',
          6000,
          6000,
          6000
        );
      `);
      db.$client
        .prepare<DeleteMigrationParameters>(
          `
            DELETE FROM __drizzle_migrations
            WHERE created_at >= ?
          `,
        )
        .run(threadTypeRemovalMigrationWhen);
      dropPost0023Tables(db);
      restoreEnvironmentCleanupModeColumn(db);
      restoreEnvironmentCleanupRequestedAtColumn(db);
      restoreThreadStopRequestedAtColumn(db);

      migrate(db);

      const threadColumns = db.$client
        .prepare<[], TableInfoRow>("PRAGMA table_info(threads)")
        .all()
        .map((row) => row.name);
      expect(threadColumns).not.toContain("type");
      expect(threadColumns).not.toContain("sort_key");

      const defaultsColumns = db.$client
        .prepare<[], TableInfoRow>(
          "PRAGMA table_info(project_execution_defaults)",
        )
        .all()
        .map((row) => row.name);
      expect(defaultsColumns).not.toContain("thread_type");

      expect(
        db.$client
          .prepare<[], MigratedManagerCleanupThreadRow>(
            `
              SELECT id, parent_thread_id AS parentThreadId
              FROM threads
              WHERE id IN ('thr_former_manager', 'thr_former_child')
              ORDER BY id
            `,
          )
          .all(),
      ).toEqual([
        {
          id: "thr_former_child",
          parentThreadId: "thr_former_manager",
        },
        {
          id: "thr_former_manager",
          parentThreadId: null,
        },
      ]);

      expect(
        db.$client
          .prepare<[], MigratedManagerCleanupDefaultRow>(
            `
              SELECT
                provider_id AS providerId,
                model,
                service_tier AS serviceTier,
                reasoning_level AS reasoningLevel,
                permission_mode AS permissionMode
              FROM project_execution_defaults
              WHERE project_id = 'proj_manager_cleanup'
            `,
          )
          .get(),
      ).toEqual({
        providerId: "codex",
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
      });

      expect(
        db.$client
          .prepare<[], Pick<MigratedThreadScheduleRow, "id" | "threadId">>(
            `
              SELECT id, thread_id AS threadId
              FROM thread_schedules
              WHERE id = 'tsched_former_manager'
            `,
          )
          .get(),
      ).toEqual({
        id: "tsched_former_manager",
        threadId: "thr_former_manager",
      });
    } finally {
      closeConnection(db);
    }
  });

  it("normalizes legacy expired pending interactions and drops session_id", () => {
    const db = createConnection(":memory:");

    try {
      db.$client.exec(`
        CREATE TABLE pending_interactions (
          id text PRIMARY KEY NOT NULL,
          thread_id text NOT NULL,
          turn_id text NOT NULL,
          provider_id text NOT NULL,
          provider_thread_id text NOT NULL,
          provider_request_id text NOT NULL,
          session_id text NOT NULL,
          status text NOT NULL,
          payload text NOT NULL,
          resolution text,
          status_reason text,
          created_at integer NOT NULL,
          resolved_at integer,
          updated_at integer NOT NULL
        );
        INSERT INTO pending_interactions (
          id,
          thread_id,
          turn_id,
          provider_id,
          provider_thread_id,
          provider_request_id,
          session_id,
          status,
          payload,
          resolution,
          status_reason,
          created_at,
          resolved_at,
          updated_at
        )
        VALUES
          (
            'pi_expired_without_reason',
            'thr_legacy_pending',
            'turn_legacy_pending_1',
            'codex',
            'provider-thread-legacy-pending',
            'request-legacy-pending-1',
            'session-legacy-pending',
            'expired',
            '{}',
            NULL,
            NULL,
            10,
            NULL,
            20
          ),
          (
            'pi_expired_with_reason',
            'thr_legacy_pending',
            'turn_legacy_pending_2',
            'codex',
            'provider-thread-legacy-pending',
            'request-legacy-pending-2',
            'session-legacy-pending',
            'expired',
            '{}',
            NULL,
            'Already expired',
            30,
            50,
            40
          ),
          (
            'pi_interrupted',
            'thr_legacy_pending',
            'turn_legacy_pending_3',
            'codex',
            'provider-thread-legacy-pending',
            'request-legacy-pending-3',
            'session-legacy-pending',
            'interrupted',
            '{}',
            NULL,
            'Manual stop',
            60,
            70,
            80
          );
        CREATE TABLE events (
          id text PRIMARY KEY NOT NULL,
          type text NOT NULL,
          data text NOT NULL
        );
        INSERT INTO events (id, type, data)
        VALUES
          (
            'evt_expired_permission_grant',
            'system/permissionGrant/lifecycle',
            '{"status":"expired","statusReason":"Already expired"}'
          ),
          (
            'evt_expired_user_question',
            'system/userQuestion/lifecycle',
            '{"status":"expired"}'
          ),
          (
            'evt_interrupted_permission_grant',
            'system/permissionGrant/lifecycle',
            '{"status":"interrupted","statusReason":"Manual stop"}'
          ),
          (
            'evt_other_expired',
            'system/operation',
            '{"status":"expired"}'
          );
      `);

      runMigrationFile({
        db,
        migrationPath: pendingInteractionSchemaHonestyMigrationPath,
      });

      const rows = db.$client
        .prepare<[], MigratedPendingInteractionStatusRow>(
          `
            SELECT
              id,
              status,
              status_reason AS statusReason,
              resolved_at AS resolvedAt,
              updated_at AS updatedAt
            FROM pending_interactions
            ORDER BY id
          `,
        )
        .all();

      expect(rows).toEqual([
        {
          id: "pi_expired_with_reason",
          status: "interrupted",
          statusReason: "Already expired",
          resolvedAt: 50,
          updatedAt: 50,
        },
        {
          id: "pi_expired_without_reason",
          status: "interrupted",
          statusReason: "Pending interaction expired",
          resolvedAt: 20,
          updatedAt: 20,
        },
        {
          id: "pi_interrupted",
          status: "interrupted",
          statusReason: "Manual stop",
          resolvedAt: 70,
          updatedAt: 80,
        },
      ]);
      const pendingInteractionColumns = db.$client
        .prepare<[], TableNameRow>(
          `
            SELECT name
            FROM pragma_table_info('pending_interactions')
            ORDER BY cid
          `,
        )
        .all()
        .map((row) => row.name);
      expect(pendingInteractionColumns).toEqual([
        "id",
        "thread_id",
        "turn_id",
        "provider_id",
        "provider_thread_id",
        "provider_request_id",
        "status",
        "payload",
        "resolution",
        "status_reason",
        "created_at",
        "resolved_at",
        "updated_at",
      ]);
      const eventRows = db.$client
        .prepare<[], MigratedPendingInteractionEventStatusRow>(
          `
            SELECT
              id,
              json_extract(data, '$.status') AS status,
              json_extract(data, '$.statusReason') AS statusReason
            FROM events
            ORDER BY id
          `,
        )
        .all();
      expect(eventRows).toEqual([
        {
          id: "evt_expired_permission_grant",
          status: "interrupted",
          statusReason: "Already expired",
        },
        {
          id: "evt_expired_user_question",
          status: "interrupted",
          statusReason: "Pending interaction expired",
        },
        {
          id: "evt_interrupted_permission_grant",
          status: "interrupted",
          statusReason: "Manual stop",
        },
        {
          id: "evt_other_expired",
          status: "expired",
          statusReason: null,
        },
      ]);
    } finally {
      closeConnection(db);
    }
  });

  it("warns when applied migration timestamps are in the future", () => {
    const db = createConnection(":memory:");
    const logger = {
      warn: vi.fn(),
    } satisfies MigrationWarningLogger;

    try {
      migrate(db);
      const latestMigrationCreatedAt = readLatestAppliedMigrationCreatedAt(db);
      vi.useFakeTimers();
      vi.setSystemTime(latestMigrationCreatedAt + 10_000);

      migrate(db, { logger });
      expect(logger.warn).not.toHaveBeenCalled();

      const futureCreatedAt = Date.now() + 60_000;
      db.$client
        .prepare<InsertMigrationParameters>(
          `
            INSERT INTO __drizzle_migrations (hash, created_at)
            VALUES (?, ?)
          `,
        )
        .run("future-migration-hash", futureCreatedAt);

      migrate(db, { logger });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        {
          migrations: [
            {
              createdAt: futureCreatedAt,
              hash: "future-migration-hash",
            },
          ],
          now: expect.any(Number),
        },
        "Applied database migrations have future timestamps",
      );
    } finally {
      closeConnection(db);
      vi.useRealTimers();
    }
  });

  it("can defer destructive legacy cleanup from a 0013 database while preserving state backfills", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);
      seedPre0014ThreadSchedulesSchema(db);
      db.$client.prepare("DROP INDEX projects_deleted_idx").run();
      db.$client.prepare("ALTER TABLE projects DROP COLUMN deleted_at").run();
      db.$client.prepare("ALTER TABLE events ADD producer_event_id text").run();
      db.$client
        .prepare("ALTER TABLE events ADD producer_event_payload_hash text")
        .run();
      db.$client
        .prepare(
          "CREATE UNIQUE INDEX events_producer_event_id_idx ON events (producer_event_id)",
        )
        .run();
      db.$client
        .prepare(
          "ALTER TABLE hosts ADD command_cursor integer DEFAULT 0 NOT NULL",
        )
        .run();
      db.$client.exec(`
        CREATE TABLE host_daemon_commands (
          id text PRIMARY KEY NOT NULL
        );
        CREATE TABLE host_daemon_command_attempts (
          id text PRIMARY KEY NOT NULL
        );
        CREATE TABLE client_turn_requests (
          id text PRIMARY KEY NOT NULL
        );
        CREATE TABLE environment_operations (
          id text PRIMARY KEY NOT NULL,
          environment_id text NOT NULL,
          kind text NOT NULL,
          state text NOT NULL
        );
        CREATE TABLE project_operations (
          id text PRIMARY KEY NOT NULL,
          project_id text NOT NULL,
          kind text NOT NULL,
          state text NOT NULL,
          requested_at integer NOT NULL
        );
        CREATE TABLE thread_operations (
          id text PRIMARY KEY NOT NULL,
          thread_id text NOT NULL,
          kind text NOT NULL,
          state text NOT NULL,
          payload text NOT NULL,
          requested_at integer NOT NULL
        );
        INSERT INTO hosts (
          id,
          name,
          type,
          command_cursor,
          created_at,
          updated_at
        )
        VALUES (
          'host_deferred_cleanup',
          'Deferred cleanup host',
          'persistent',
          0,
          1000,
          1000
        );
        INSERT INTO projects (
          id,
          name,
          created_at,
          updated_at
        )
        VALUES (
          'proj_deferred_cleanup',
          'Deferred cleanup project',
          1000,
          1000
        );
        INSERT INTO environments (
          id,
          project_id,
          host_id,
          path,
          workspace_provision_type,
          status,
          created_at,
          updated_at
        )
        VALUES (
          'env_deferred_cleanup',
          'proj_deferred_cleanup',
          'host_deferred_cleanup',
          '/tmp/deferred-cleanup',
          'managed-worktree',
          'provisioning',
          1000,
          1000
        );
        INSERT INTO threads (
          id,
          project_id,
          environment_id,
          provider_id,
          status,
          latest_attention_at,
          created_at,
          updated_at
        )
        VALUES (
          'thr_deferred_cleanup',
          'proj_deferred_cleanup',
          'env_deferred_cleanup',
          'codex',
          'provisioning',
          1000,
          1000,
          1000
        ),
        (
          'thr_deferred_bad_stop_reason',
          'proj_deferred_cleanup',
          'env_deferred_cleanup',
          'codex',
          'active',
          1000,
          1000,
          1000
        );
        INSERT INTO thread_operations (
          id,
          thread_id,
          kind,
          state,
          payload,
          requested_at
        )
        VALUES
          (
            'top_deferred_provision',
            'thr_deferred_cleanup',
            'provision',
            'queued',
            '{}',
            2000
          ),
          (
            'top_deferred_stop',
            'thr_deferred_cleanup',
            'stop',
            'requested',
            '{"interruptionReason":"host-daemon-restarted"}',
            2500
          ),
          (
            'top_deferred_bad_stop_reason',
            'thr_deferred_bad_stop_reason',
            'stop',
            'queued',
            '{"interruptionReason":"legacy-freeform-reason"}',
            2550
          );
        INSERT INTO environment_operations (
          id,
          environment_id,
          kind,
          state
        )
        VALUES (
          'eop_deferred_provision',
          'env_deferred_cleanup',
          'provision',
          'queued'
        );
        INSERT INTO project_operations (
          id,
          project_id,
          kind,
          state,
          requested_at
        )
        VALUES (
          'pop_deferred_delete',
          'proj_deferred_cleanup',
          'delete',
          'requested',
          3000
        );
      `);
      deleteDeferredCleanupMigrationRows(db);
      restoreEnvironmentCleanupRequestedAtColumn(db);
      restoreThreadStopRequestedAtColumn(db);

      migrate(db, { deferDestructiveLegacyCleanup: true });

      expect(readTableNames(db)).toEqual(
        expect.arrayContaining([
          "client_turn_requests",
          "environment_operations",
          "host_daemon_command_attempts",
          "host_daemon_commands",
          "project_operations",
          "thread_operations",
        ]),
      );
      expect(
        db.$client
          .prepare<[], TableInfoRow>("PRAGMA table_info(events)")
          .all()
          .map((row) => row.name),
      ).toEqual(expect.arrayContaining(["producer_event_id"]));
      expect(
        db.$client
          .prepare<[], TableInfoRow>("PRAGMA table_info(hosts)")
          .all()
          .map((row) => row.name),
      ).toEqual(expect.arrayContaining(["command_cursor"]));
      // The legacy thread_operations stop backfill still drives the thread to
      // error; stop_requested_at is no longer a column (dropped by 0031), so it
      // can't be asserted — the durable stop intent is now the status itself.
      expect(
        db.$client
          .prepare<[], OperationBackfillThreadRow>(
            `
              SELECT status
              FROM threads
              WHERE id = 'thr_deferred_cleanup'
            `,
          )
          .get(),
      ).toEqual({
        status: "error",
      });
      expect(
        db.$client
          .prepare<[], OperationBackfillProjectRow>(
            `
              SELECT deleted_at AS deletedAt
              FROM projects
              WHERE id = 'proj_deferred_cleanup'
            `,
          )
          .get(),
      ).toEqual({
        deletedAt: 3_000,
      });
      expect(
        db.$client
          .prepare<[], OperationBackfillEnvironmentRow>(
            `
              SELECT status
              FROM environments
              WHERE id = 'env_deferred_cleanup'
            `,
          )
          .get(),
      ).toEqual({
        status: "error",
      });
      expect(
        db.$client
          .prepare<[], MigratedEventRow>(
            `
              SELECT
                id,
                thread_id AS threadId,
                environment_id AS environmentId,
                scope_kind AS scopeKind,
                turn_id AS turnId,
                provider_thread_id AS providerThreadId,
                sequence,
                type,
                item_id AS itemId,
                item_kind AS itemKind,
                data,
                created_at AS createdAt
              FROM events
              WHERE id = 'evt_top_deferred_stop'
            `,
          )
          .get(),
      ).toEqual({
        createdAt: 2_500,
        data: '{"reason":"host-daemon-restarted"}',
        environmentId: "env_deferred_cleanup",
        id: "evt_top_deferred_stop",
        itemId: null,
        itemKind: null,
        providerThreadId: null,
        scopeKind: "thread",
        sequence: 1,
        threadId: "thr_deferred_cleanup",
        turnId: null,
        type: "system/thread/interrupted",
      });
      expect(
        db.$client
          .prepare<[], Pick<MigratedEventRow, "data">>(
            `
              SELECT data
              FROM events
              WHERE id = 'evt_top_deferred_bad_stop_reason'
            `,
          )
          .get(),
      ).toEqual({
        data: '{"reason":"manual-stop"}',
      });

      const migrationCreatedAts = db.$client
        .prepare<[], MigrationCreatedAtRow>(
          `
            SELECT created_at AS createdAt
            FROM __drizzle_migrations
            ORDER BY created_at
          `,
        )
        .all()
        .map((row) => row.createdAt);
      expect(migrationCreatedAts).toEqual(
        expect.arrayContaining([
          threadScheduleKindDefaultMigrationWhen,
          operationStateBackfillMigrationWhen,
          eventProducerColumnsMigrationWhen,
          terminalSessionRuntimeStateHonestyWhen,
          hostDaemonSessionObservabilityMigrationWhen,
        ]),
      );
    } finally {
      closeConnection(db);
    }
  });

  it("rolls back the manual 0014 deferred migration when the rebuild fails", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);
      seedFailingPre0014ThreadSchedulesSchema(db);
      deleteDeferredCleanupMigrationRows(db);

      expect(() =>
        migrate(db, { deferDestructiveLegacyCleanup: true }),
      ).toThrow(/NOT NULL constraint failed/);

      expect(readTableNames(db)).toEqual(
        expect.arrayContaining(["thread_schedules"]),
      );
      expect(readTableNames(db)).not.toContain("__new_thread_schedules");
      expect(
        db.$client
          .prepare<[number], MigrationCountRow>(
            `
              SELECT COUNT(*) AS count
              FROM __drizzle_migrations
              WHERE created_at = ?
            `,
          )
          .get(threadScheduleKindDefaultMigrationWhen),
      ).toEqual({ count: 0 });
      const kindColumn = db.$client
        .prepare<[], TableInfoRow>("PRAGMA table_info(thread_schedules)")
        .all()
        .find((row) => row.name === "kind");
      expect(kindColumn?.notnull).toBe(0);
    } finally {
      closeConnection(db);
    }
  });

  it("applies 0002 after a database already applied main's 0001 timestamp", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);
      restorePre0022ThreadTypeSchema(db);
      addPre0017TerminalRuntimeColumns(db);

      db.$client
        .prepare("DROP INDEX host_daemon_sessions_closed_prune_idx")
        .run();
      db.$client
        .prepare(
          "DROP INDEX thread_dynamic_context_file_states_thread_file_idx",
        )
        .run();
      db.$client.prepare("DROP INDEX projects_sort_idx").run();
      db.$client.prepare("DROP INDEX projects_personal_singleton_idx").run();
      db.$client.prepare("DROP INDEX threads_project_type_sort_idx").run();
      db.$client.prepare("DROP INDEX threads_pin_sort_idx").run();
      db.$client.prepare("DROP TABLE thread_schedules").run();
      db.$client
        .prepare(
          `
            CREATE TABLE manager_thread_nudges (
              id text PRIMARY KEY NOT NULL,
              project_id text NOT NULL,
              thread_id text NOT NULL,
              name text NOT NULL,
              cron text NOT NULL,
              timezone text NOT NULL,
              enabled integer DEFAULT true NOT NULL,
              next_fire_at integer NOT NULL,
              last_fired_at integer,
              created_at integer NOT NULL,
              updated_at integer NOT NULL,
              FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE no action ON DELETE cascade,
              FOREIGN KEY (thread_id) REFERENCES threads(id) ON UPDATE no action ON DELETE cascade
            )
          `,
        )
        .run();
      db.$client.prepare("DROP TABLE thread_dynamic_context_file_states").run();
      db.$client.prepare("DROP TABLE IF EXISTS workflow_run_events").run();
      db.$client.prepare("DROP TABLE IF EXISTS workflow_run_operations").run();
      db.$client.prepare("DROP TABLE IF EXISTS workflow_runs").run();
      db.$client
        .prepare("DROP TABLE IF EXISTS project_workflow_policies")
        .run();
      db.$client.prepare("DELETE FROM projects WHERE kind = 'personal'").run();
      db.$client.prepare("ALTER TABLE projects DROP COLUMN kind").run();
      db.$client.prepare("ALTER TABLE projects DROP COLUMN sort_key").run();
      db.$client.prepare("ALTER TABLE threads DROP COLUMN sort_key").run();
      db.$client.prepare("ALTER TABLE threads DROP COLUMN pinned_at").run();
      db.$client.prepare("ALTER TABLE threads DROP COLUMN pin_sort_key").run();
      db.$client
        .prepare("ALTER TABLE threads DROP COLUMN model_override")
        .run();
      db.$client
        .prepare("ALTER TABLE threads DROP COLUMN reasoning_level_override")
        .run();
      db.$client.prepare("ALTER TABLE events ADD producer_event_id text").run();
      db.$client
        .prepare("ALTER TABLE events ADD producer_event_payload_hash text")
        .run();
      db.$client
        .prepare(
          "CREATE UNIQUE INDEX events_producer_event_id_idx ON events (producer_event_id)",
        )
        .run();
      db.$client.prepare("DROP INDEX projects_deleted_idx").run();
      db.$client.prepare("ALTER TABLE projects DROP COLUMN deleted_at").run();
      db.$client
        .prepare(
          "ALTER TABLE hosts ADD command_cursor integer DEFAULT 0 NOT NULL",
        )
        .run();
      db.$client.exec(`
        CREATE TABLE host_daemon_commands (
          id text PRIMARY KEY NOT NULL,
          host_id text NOT NULL,
          session_id text,
          cursor integer NOT NULL,
          type text NOT NULL,
          payload text NOT NULL,
          state text NOT NULL,
          retry_count integer DEFAULT 0 NOT NULL,
          result_payload text,
          created_at integer NOT NULL,
          fetched_at integer,
          completed_at integer,
          FOREIGN KEY (host_id) REFERENCES hosts(id) ON UPDATE no action ON DELETE cascade,
          FOREIGN KEY (session_id) REFERENCES host_daemon_sessions(id) ON UPDATE no action ON DELETE set null
        );
        CREATE TABLE environment_operations (
          id text PRIMARY KEY NOT NULL,
          environment_id text NOT NULL,
          kind text NOT NULL,
          state text NOT NULL,
          payload text NOT NULL,
          command_id text,
          requested_at integer NOT NULL,
          queued_at integer,
          completed_at integer,
          failure_reason text,
          created_at integer NOT NULL,
          updated_at integer NOT NULL,
          FOREIGN KEY (environment_id) REFERENCES environments(id) ON UPDATE no action ON DELETE cascade,
          FOREIGN KEY (command_id) REFERENCES host_daemon_commands(id) ON UPDATE no action ON DELETE set null
        );
        CREATE UNIQUE INDEX environment_operations_environment_kind_idx ON environment_operations (environment_id, kind);
        CREATE UNIQUE INDEX environment_operations_command_idx ON environment_operations (command_id);
        CREATE INDEX environment_operations_state_idx ON environment_operations (state);
        CREATE INDEX environment_operations_environment_idx ON environment_operations (environment_id);
        CREATE TABLE project_operations (
          id text PRIMARY KEY NOT NULL,
          project_id text NOT NULL,
          kind text NOT NULL,
          state text NOT NULL,
          payload text NOT NULL,
          command_id text,
          requested_at integer NOT NULL,
          queued_at integer,
          completed_at integer,
          failure_reason text,
          created_at integer NOT NULL,
          updated_at integer NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE no action ON DELETE cascade,
          FOREIGN KEY (command_id) REFERENCES host_daemon_commands(id) ON UPDATE no action ON DELETE set null
        );
        CREATE UNIQUE INDEX project_operations_project_kind_idx ON project_operations (project_id, kind);
        CREATE UNIQUE INDEX project_operations_command_idx ON project_operations (command_id);
        CREATE INDEX project_operations_state_idx ON project_operations (state);
        CREATE INDEX project_operations_project_idx ON project_operations (project_id);
        CREATE TABLE thread_operations (
          id text PRIMARY KEY NOT NULL,
          thread_id text NOT NULL,
          kind text NOT NULL,
          state text NOT NULL,
          payload text NOT NULL,
          provisioning_id text,
          provisioning_stage text,
          provisioning_environment_id text,
          provision_event_sequence integer,
          workspace_ready_event_sequence integer,
          command_id text,
          requested_at integer NOT NULL,
          queued_at integer,
          completed_at integer,
          failure_reason text,
          created_at integer NOT NULL,
          updated_at integer NOT NULL,
          FOREIGN KEY (thread_id) REFERENCES threads(id) ON UPDATE no action ON DELETE cascade,
          FOREIGN KEY (provisioning_environment_id) REFERENCES environments(id) ON UPDATE no action ON DELETE set null,
          FOREIGN KEY (command_id) REFERENCES host_daemon_commands(id) ON UPDATE no action ON DELETE set null
        );
        CREATE UNIQUE INDEX thread_operations_thread_kind_idx ON thread_operations (thread_id, kind);
        CREATE UNIQUE INDEX thread_operations_command_idx ON thread_operations (command_id);
        CREATE INDEX thread_operations_state_idx ON thread_operations (state);
        CREATE INDEX thread_operations_thread_idx ON thread_operations (thread_id);
      `);
      db.$client.exec(`
        INSERT INTO hosts (
          id,
          name,
          type,
          command_cursor,
          destroyed_at,
          last_seen_at,
          created_at,
          updated_at
        )
        VALUES (
          'host_legacy_operation_backfill',
          'Legacy operation backfill host',
          'persistent',
          0,
          NULL,
          NULL,
          1000,
          1000
        );
        INSERT INTO projects (
          id,
          name,
          created_at,
          updated_at
        )
        VALUES (
          'proj_legacy_operation_backfill',
          'Legacy operation backfill project',
          1000,
          1000
        );
        INSERT INTO environments (
          id,
          project_id,
          host_id,
          path,
          managed,
          is_git_repo,
          is_worktree,
          workspace_provision_type,
          status,
          created_at,
          updated_at
        )
        VALUES (
          'env_legacy_operation_backfill',
          'proj_legacy_operation_backfill',
          'host_legacy_operation_backfill',
          '/tmp/legacy-operation-backfill',
          1,
          1,
          1,
          'managed-worktree',
          'provisioning',
          1000,
          1000
        );
        INSERT INTO threads (
          id,
          project_id,
          environment_id,
          provider_id,
          status,
          latest_attention_at,
          created_at,
          updated_at
        )
        VALUES (
          'thr_legacy_operation_backfill',
          'proj_legacy_operation_backfill',
          'env_legacy_operation_backfill',
          'codex',
          'provisioning',
          1000,
          1000,
          1000
        );
        INSERT INTO threads (
          id,
          project_id,
          environment_id,
          provider_id,
          status,
          latest_attention_at,
          created_at,
          updated_at
        )
        VALUES (
          'thr_legacy_bad_stop_reason',
          'proj_legacy_operation_backfill',
          'env_legacy_operation_backfill',
          'codex',
          'active',
          1000,
          1000,
          1000
        );
        INSERT INTO thread_operations (
          id,
          thread_id,
          kind,
          state,
          payload,
          provisioning_id,
          provisioning_stage,
          provisioning_environment_id,
          provision_event_sequence,
          workspace_ready_event_sequence,
          command_id,
          requested_at,
          queued_at,
          completed_at,
          failure_reason,
          created_at,
          updated_at
        )
        VALUES (
          'top_legacy_provision_backfill',
          'thr_legacy_operation_backfill',
          'provision',
          'queued',
          '{"workspaceProvisionType":"managed-worktree"}',
          'tpv_legacy_operation_backfill',
          'workspace-ready',
          'env_legacy_operation_backfill',
          41,
          42,
          NULL,
          2000,
          2010,
          NULL,
          NULL,
          2000,
          2010
        );
        INSERT INTO thread_operations (
          id,
          thread_id,
          kind,
          state,
          payload,
          provisioning_id,
          provisioning_stage,
          provisioning_environment_id,
          provision_event_sequence,
          workspace_ready_event_sequence,
          command_id,
          requested_at,
          queued_at,
          completed_at,
          failure_reason,
          created_at,
          updated_at
        )
        VALUES (
          'top_legacy_stop_backfill',
          'thr_legacy_operation_backfill',
          'stop',
          'requested',
          '{"interruptionReason":"host-daemon-restarted"}',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          2500,
          NULL,
          NULL,
          NULL,
          2500,
          2500
        );
        INSERT INTO thread_operations (
          id,
          thread_id,
          kind,
          state,
          payload,
          provisioning_id,
          provisioning_stage,
          provisioning_environment_id,
          provision_event_sequence,
          workspace_ready_event_sequence,
          command_id,
          requested_at,
          queued_at,
          completed_at,
          failure_reason,
          created_at,
          updated_at
        )
        VALUES (
          'top_legacy_bad_stop_reason',
          'thr_legacy_bad_stop_reason',
          'stop',
          'queued',
          '{"interruptionReason":"legacy-freeform-reason"}',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          2550,
          2560,
          NULL,
          NULL,
          2550,
          2560
        );
        INSERT INTO environment_operations (
          id,
          environment_id,
          kind,
          state,
          payload,
          command_id,
          requested_at,
          queued_at,
          completed_at,
          failure_reason,
          created_at,
          updated_at
        )
        VALUES (
          'eop_legacy_provision_backfill',
          'env_legacy_operation_backfill',
          'provision',
          'queued',
          '{}',
          NULL,
          2600,
          2610,
          NULL,
          NULL,
          2600,
          2610
        );
        INSERT INTO project_operations (
          id,
          project_id,
          kind,
          state,
          payload,
          command_id,
          requested_at,
          queued_at,
          completed_at,
          failure_reason,
          created_at,
          updated_at
        )
        VALUES (
          'pop_legacy_delete_backfill',
          'proj_legacy_operation_backfill',
          'delete',
          'requested',
          '{}',
          NULL,
          3000,
          NULL,
          NULL,
          NULL,
          3000,
          3000
        );
      `);
      db.$client
        .prepare(
          "ALTER TABLE host_daemon_sessions ADD COLUMN last_heartbeat_at integer",
        )
        .run();
      db.$client
        .prepare(
          "ALTER TABLE pending_interactions ADD COLUMN session_id text NOT NULL DEFAULT 'legacy-session'",
        )
        .run();
      db.$client.prepare("DELETE FROM __drizzle_migrations").run();
      db.$client
        .prepare<InsertMigrationParameters>(
          `
            INSERT INTO __drizzle_migrations (hash, created_at)
            VALUES (?, ?)
          `,
        )
        .run("baseline-hash", baselineWhen);
      db.$client
        .prepare<InsertMigrationParameters>(
          `
            INSERT INTO __drizzle_migrations (hash, created_at)
            VALUES (?, ?)
          `,
        )
        .run("main-0001-hash", publishedTerminalSessionUserInputWhen);
      dropEnvironmentNameColumn(db);
      dropEnvironmentDestroyAttemptIdColumn(db);
      restoreEnvironmentCleanupModeColumn(db);
      restoreEnvironmentCleanupRequestedAtColumn(db);
      restoreThreadStopRequestedAtColumn(db);
      dropPost0023Tables(db);

      expect(
        readIndexNames({ db, tableName: "host_daemon_sessions" }),
      ).not.toContain("host_daemon_sessions_closed_prune_idx");

      migrate(db);

      expect(
        readIndexNames({ db, tableName: "host_daemon_sessions" }),
      ).toContain("host_daemon_sessions_closed_prune_idx");
      expect(readTableNames(db)).not.toEqual(
        expect.arrayContaining([
          "client_turn_requests",
          "environment_operations",
          "host_daemon_command_attempts",
          "host_daemon_commands",
          "project_operations",
          "thread_operations",
        ]),
      );
      expect(
        db.$client
          .prepare<[], TableInfoRow>("PRAGMA table_info(hosts)")
          .all()
          .map((row) => row.name),
      ).not.toContain("command_cursor");
      expect(
        db.$client
          .prepare<[], TableInfoRow>("PRAGMA table_info(events)")
          .all()
          .map((row) => row.name),
      ).toEqual([
        "id",
        "thread_id",
        "environment_id",
        "scope_kind",
        "turn_id",
        "provider_thread_id",
        "sequence",
        "type",
        "item_id",
        "item_kind",
        "data",
        "created_at",
      ]);
      const eventIndexNames = readIndexNames({
        db,
        tableName: "events",
      }).filter((name) => !name.startsWith("sqlite_"));
      expect(eventIndexNames).toEqual([
        "events_completed_item_truncation_idx",
        "events_environment_idx",
        "events_thread_sequence_idx",
        "events_thread_turn_type_item_sequence_idx",
        "events_thread_type_item_kind_sequence_idx",
        "events_thread_type_sequence_idx",
      ]);

      const migrationCreatedAts = db.$client
        .prepare<[], MigrationCreatedAtRow>(
          `
            SELECT created_at AS createdAt
            FROM __drizzle_migrations
            ORDER BY created_at
          `,
        )
        .all()
        .map((row) => row.createdAt);
      expect(migrationCreatedAts).toContain(closedSessionPruneIndexesWhen);
      expect(migrationCreatedAts).toContain(threadDynamicContextFileStatesWhen);
      expect(migrationCreatedAts).toContain(commandLookupIndexesWhen);
      expect(migrationCreatedAts).toContain(threadPinningMigrationWhen);
      // The legacy thread_operations stop backfill still drives the thread to
      // error; stop_requested_at is no longer a column (dropped by 0031).
      expect(
        db.$client
          .prepare<[], OperationBackfillThreadRow>(
            `
            SELECT status
              FROM threads
              WHERE id = 'thr_legacy_operation_backfill'
            `,
          )
          .get(),
      ).toEqual({
        status: "error",
      });
      const interruptedEvent = db.$client
        .prepare<[], MigratedEventRow>(
          `
            SELECT
              id,
              thread_id AS threadId,
              environment_id AS environmentId,
              scope_kind AS scopeKind,
              turn_id AS turnId,
              provider_thread_id AS providerThreadId,
              sequence,
              type,
              item_id AS itemId,
              item_kind AS itemKind,
              data,
              created_at AS createdAt
            FROM events
            WHERE id = 'evt_top_legacy_stop_backfill'
          `,
        )
        .get();
      expect(interruptedEvent).toEqual({
        createdAt: 2_500,
        data: '{"reason":"host-daemon-restarted"}',
        environmentId: "env_legacy_operation_backfill",
        id: "evt_top_legacy_stop_backfill",
        itemId: null,
        itemKind: null,
        providerThreadId: null,
        scopeKind: "thread",
        sequence: 1,
        threadId: "thr_legacy_operation_backfill",
        turnId: null,
        type: "system/thread/interrupted",
      });
      expect(
        db.$client
          .prepare<[], Pick<MigratedEventRow, "data">>(
            `
              SELECT data
              FROM events
              WHERE id = 'evt_top_legacy_bad_stop_reason'
            `,
          )
          .get(),
      ).toEqual({
        data: '{"reason":"manual-stop"}',
      });
      expect(
        db.$client
          .prepare<[], OperationBackfillEnvironmentRow>(
            `
              SELECT status
              FROM environments
              WHERE id = 'env_legacy_operation_backfill'
            `,
          )
          .get(),
      ).toEqual({
        status: "error",
      });
      expect(
        db.$client
          .prepare<[], OperationBackfillProjectRow>(
            `
              SELECT deleted_at AS deletedAt
              FROM projects
              WHERE id = 'proj_legacy_operation_backfill'
            `,
          )
          .get(),
      ).toEqual({
        deletedAt: 3_000,
      });
    } finally {
      closeConnection(db);
    }
  });

  it("copies legacy manager nudges into thread schedules", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);
      restorePre0022ThreadTypeSchema(db);
      addPre0017TerminalRuntimeColumns(db);

      db.$client.prepare("DROP TABLE thread_schedules").run();
      db.$client.prepare("DROP INDEX projects_deleted_idx").run();
      db.$client.prepare("ALTER TABLE projects DROP COLUMN deleted_at").run();
      db.$client
        .prepare(
          "ALTER TABLE hosts ADD command_cursor integer DEFAULT 0 NOT NULL",
        )
        .run();
      db.$client.prepare("ALTER TABLE events ADD producer_event_id text").run();
      db.$client
        .prepare("ALTER TABLE events ADD producer_event_payload_hash text")
        .run();
      db.$client
        .prepare(
          "CREATE UNIQUE INDEX events_producer_event_id_idx ON events (producer_event_id)",
        )
        .run();
      db.$client
        .prepare(
          `
            CREATE TABLE manager_thread_nudges (
              id text PRIMARY KEY NOT NULL,
              project_id text NOT NULL,
              thread_id text NOT NULL,
              name text NOT NULL,
              cron text NOT NULL,
              timezone text NOT NULL,
              enabled integer DEFAULT true NOT NULL,
              next_fire_at integer NOT NULL,
              last_fired_at integer,
              created_at integer NOT NULL,
              updated_at integer NOT NULL,
              FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE no action ON DELETE cascade,
              FOREIGN KEY (thread_id) REFERENCES threads(id) ON UPDATE no action ON DELETE cascade
            )
          `,
        )
        .run();
      db.$client.exec(`
        CREATE TABLE host_daemon_commands (
          id text PRIMARY KEY NOT NULL
        );
        CREATE TABLE host_daemon_command_attempts (
          id text PRIMARY KEY NOT NULL
        );
        CREATE TABLE client_turn_requests (
          id text PRIMARY KEY NOT NULL
        );
        CREATE TABLE environment_operations (
          id text PRIMARY KEY NOT NULL,
          environment_id text NOT NULL,
          kind text NOT NULL,
          state text NOT NULL
        );
        CREATE TABLE project_operations (
          id text PRIMARY KEY NOT NULL,
          project_id text NOT NULL,
          kind text NOT NULL,
          state text NOT NULL,
          requested_at integer NOT NULL
        );
        CREATE TABLE thread_operations (
          id text PRIMARY KEY NOT NULL,
          thread_id text NOT NULL,
          kind text NOT NULL,
          state text NOT NULL,
          payload text NOT NULL,
          requested_at integer NOT NULL
        );
      `);
      db.$client
        .prepare(
          "ALTER TABLE host_daemon_sessions ADD COLUMN last_heartbeat_at integer",
        )
        .run();
      db.$client
        .prepare(
          "ALTER TABLE pending_interactions ADD COLUMN session_id text NOT NULL DEFAULT 'legacy-session'",
        )
        .run();
      db.$client
        .prepare<DeleteMigrationParameters>(
          `
            DELETE FROM __drizzle_migrations
            WHERE created_at >= ?
          `,
        )
        .run(threadSchedulesMigrationWhen);
      dropEnvironmentNameColumn(db);
      dropEnvironmentDestroyAttemptIdColumn(db);
      dropQueuedMessageSenderThreadIdColumn(db);
      restoreEnvironmentCleanupModeColumn(db);
      restoreEnvironmentCleanupRequestedAtColumn(db);
      restoreThreadStopRequestedAtColumn(db);
      dropPost0023Tables(db);
      db.$client
        .prepare(
          `
            INSERT INTO projects (
              id,
              kind,
              name,
              sort_key,
              created_at,
              updated_at
            )
            VALUES (
              'proj_legacy_nudges',
              'standard',
              'Legacy nudges',
              'V',
              1770000000000,
              1770000000000
            )
          `,
        )
        .run();
      db.$client
        .prepare(
          `
            INSERT INTO threads (
              id,
              project_id,
              provider_id,
              type,
              status,
              latest_attention_at,
              created_at,
              updated_at
            )
            VALUES (
              'thr_legacy_manager',
              'proj_legacy_nudges',
              'codex',
              'manager',
              'idle',
              1770000000000,
              1770000000000,
              1770000000000
            )
          `,
        )
        .run();
      const insertLegacyNudge =
        db.$client.prepare<LegacyNudgeMigrationInsertParameters>(
          `
            INSERT INTO manager_thread_nudges (
              id,
              project_id,
              thread_id,
              name,
              cron,
              timezone,
              enabled,
              next_fire_at,
              last_fired_at,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        );
      insertLegacyNudge.run(
        "mnge_daily_review",
        "proj_legacy_nudges",
        "thr_legacy_manager",
        "Daily review",
        "0 9 * * *",
        "America/Los_Angeles",
        1,
        1770100000000,
        null,
        1770000001000,
        1770000002000,
      );
      insertLegacyNudge.run(
        "mnge_weekly_report",
        "proj_legacy_nudges",
        "thr_legacy_manager",
        "Weekly report",
        "30 16 * * 5",
        "UTC",
        0,
        1770200000000,
        1770150000000,
        1770000003000,
        1770000004000,
      );

      migrate(db);

      expect(
        db.$client
          .prepare<[], MigratedThreadScheduleRow>(
            `
              SELECT
                id,
                project_id AS projectId,
                thread_id AS threadId,
                name,
                enabled,
                kind,
                cron,
                timezone,
                prompt,
                next_fire_at AS nextFireAt,
                last_fired_at AS lastFiredAt,
                created_at AS createdAt,
                updated_at AS updatedAt
              FROM thread_schedules
              ORDER BY id
            `,
          )
          .all(),
      ).toEqual([
        {
          id: "tsched_daily_review",
          projectId: "proj_legacy_nudges",
          threadId: "thr_legacy_manager",
          name: "Daily review",
          enabled: 1,
          kind: "cron",
          cron: "0 9 * * *",
          timezone: "America/Los_Angeles",
          prompt:
            "Scheduled follow-up: Daily review. Review the thread context and storage, then continue only if there is useful work to do.",
          nextFireAt: 1770100000000,
          lastFiredAt: null,
          createdAt: 1770000001000,
          updatedAt: 1770000002000,
        },
        {
          id: "tsched_weekly_report",
          projectId: "proj_legacy_nudges",
          threadId: "thr_legacy_manager",
          name: "Weekly report",
          enabled: 0,
          kind: "cron",
          cron: "30 16 * * 5",
          timezone: "UTC",
          prompt:
            "Scheduled follow-up: Weekly report. Review the thread context and storage, then continue only if there is useful work to do.",
          nextFireAt: 1770200000000,
          lastFiredAt: 1770150000000,
          createdAt: 1770000003000,
          updatedAt: 1770000004000,
        },
      ]);
      expect(
        db.$client
          .prepare<TableNameParameters, IndexNameRow>(
            `
              SELECT name
              FROM sqlite_master
              WHERE type = 'table'
                AND name = ?
            `,
          )
          .get("manager_thread_nudges"),
      ).toBeUndefined();
    } finally {
      closeConnection(db);
    }
  });

  it("preserves durable terminal session data when applying 0017", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);
      restorePre0022ThreadTypeSchema(db);
      seedPre0017TerminalSessionMigration({ db });
      db.$client
        .prepare(
          "ALTER TABLE host_daemon_sessions ADD COLUMN last_heartbeat_at integer",
        )
        .run();
      db.$client
        .prepare<DeleteMigrationParameters>(
          `
            DELETE FROM __drizzle_migrations
            WHERE created_at >= ?
          `,
        )
        .run(terminalSessionRuntimeStateHonestyWhen);
      dropEnvironmentNameColumn(db);
      dropEnvironmentDestroyAttemptIdColumn(db);
      dropQueuedMessageSenderThreadIdColumn(db);
      restoreEnvironmentCleanupModeColumn(db);
      restoreEnvironmentCleanupRequestedAtColumn(db);
      restoreThreadStopRequestedAtColumn(db);
      dropPost0023Tables(db);

      migrate(db);

      expect(
        db.$client
          .prepare<[], MigratedTerminalSessionRow>(
            `
              SELECT
                id,
                thread_id AS threadId,
                environment_id AS environmentId,
                host_id AS hostId,
                daemon_session_id AS daemonSessionId,
                title,
                initial_cwd AS initialCwd,
                cols,
                rows,
                status,
                exit_code AS exitCode,
                close_reason AS closeReason,
                created_at AS createdAt,
                updated_at AS updatedAt,
                last_user_input_at AS lastUserInputAt
              FROM terminal_sessions
              WHERE id = 'term_pre0017'
            `,
          )
          .get(),
      ).toEqual({
        id: "term_pre0017",
        threadId: "thr_pre0017",
        environmentId: "env_pre0017",
        hostId: "host_pre0017",
        daemonSessionId: "sess_pre0017",
        title: "Terminal 1",
        initialCwd: "/tmp/pre0017",
        cols: 120,
        rows: 40,
        status: "running",
        exitCode: null,
        closeReason: null,
        createdAt: 1100,
        updatedAt: 1200,
        lastUserInputAt: 1300,
      });

      const terminalSessionColumns = db.$client
        .prepare<[], TableInfoRow>("PRAGMA table_info(terminal_sessions)")
        .all()
        .map((column) => column.name);
      expect(terminalSessionColumns).not.toContain("current_cwd");
      expect(terminalSessionColumns).not.toContain("last_connected_at");
      expect(terminalSessionColumns).not.toContain("exited_at");

      const hostDaemonSessionColumns = db.$client
        .prepare<[], TableInfoRow>("PRAGMA table_info(host_daemon_sessions)")
        .all()
        .map((column) => column.name);
      expect(hostDaemonSessionColumns).not.toContain("last_heartbeat_at");
    } finally {
      closeConnection(db);
    }
  });

  it("restores legacy large event values to inline payloads", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);
      seedEventLargeValueBackfillThread(db);

      const commandOutput = "command output ".repeat(48);
      const toolResult = { body: "tool result ".repeat(48) };
      const webFetchResult = "web fetch result ".repeat(40);
      const webSearchResult = "web search result ".repeat(40);
      const firstDiff = "first diff ".repeat(60);
      const secondDiff = "second diff ".repeat(60);

      seedEventLargeValueBackfillEvent(db, {
        id: "evt_large_command_output",
        itemId: "cmd_large",
        itemKind: "commandExecution",
        sequence: 1,
        createdAt: 2001,
        data: JSON.stringify({
          item: {
            id: "cmd_large",
            type: "commandExecution",
            aggregatedOutput: commandOutput,
          },
        }),
      });
      seedEventLargeValueBackfillEvent(db, {
        id: "evt_large_tool_result",
        itemId: "tool_large",
        itemKind: "toolCall",
        sequence: 2,
        createdAt: 2002,
        data: JSON.stringify({
          item: {
            id: "tool_large",
            type: "toolCall",
            result: toolResult,
          },
        }),
      });
      seedEventLargeValueBackfillEvent(db, {
        id: "evt_large_web_fetch",
        itemId: "web_fetch_large",
        itemKind: "webFetch",
        sequence: 3,
        createdAt: 2003,
        data: JSON.stringify({
          item: {
            id: "web_fetch_large",
            type: "webFetch",
            resultText: webFetchResult,
          },
        }),
      });
      seedEventLargeValueBackfillEvent(db, {
        id: "evt_large_web_search",
        itemId: "web_search_large",
        itemKind: "webSearch",
        sequence: 4,
        createdAt: 2004,
        data: JSON.stringify({
          item: {
            id: "web_search_large",
            type: "webSearch",
            resultText: webSearchResult,
          },
        }),
      });
      seedEventLargeValueBackfillEvent(db, {
        id: "evt_large_file_diffs",
        itemId: "file_large",
        itemKind: "fileChange",
        sequence: 5,
        createdAt: 2005,
        data: JSON.stringify({
          item: {
            id: "file_large",
            type: "fileChange",
            changes: [
              { path: "a.ts", diff: firstDiff },
              { path: "b.ts", diff: "small diff" },
              { path: "c.ts", diff: secondDiff },
            ],
          },
        }),
      });

      markEventLargeValuesMigrationUnapplied(db);
      migrate(db);

      expect(readAppliedMigrationCreatedAts(db)).toContain(
        eventLargeValuesRestoreMigrationWhen,
      );
      expect(readTableNames(db)).not.toContain("event_large_values");

      const commandData = JSON.parse(
        readMigratedEventData(db, "evt_large_command_output"),
      );
      expect(commandData.item.aggregatedOutput).toBe(commandOutput);
      expect(commandData.item.truncation).toBeUndefined();

      const toolData = JSON.parse(
        readMigratedEventData(db, "evt_large_tool_result"),
      );
      expect(toolData.item.result).toEqual(toolResult);
      expect(toolData.item.truncation).toBeUndefined();

      const webFetchData = JSON.parse(
        readMigratedEventData(db, "evt_large_web_fetch"),
      );
      expect(webFetchData.item.resultText).toBe(webFetchResult);
      expect(webFetchData.item.truncation).toBeUndefined();

      const webSearchData = JSON.parse(
        readMigratedEventData(db, "evt_large_web_search"),
      );
      expect(webSearchData.item.resultText).toBe(webSearchResult);
      expect(webSearchData.item.truncation).toBeUndefined();

      const fileData = JSON.parse(
        readMigratedEventData(db, "evt_large_file_diffs"),
      );
      expect(fileData.item.changes).toEqual([
        { path: "a.ts", diff: firstDiff },
        { path: "b.ts", diff: "small diff" },
        { path: "c.ts", diff: secondDiff },
      ]);
    } finally {
      closeConnection(db);
    }
  });

  it("throws when an applied migration hash is missing behind the latest timestamp", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);
      db.$client
        .prepare<DeleteMigrationParameters>(
          `
            DELETE FROM __drizzle_migrations
            WHERE created_at = ?
          `,
        )
        .run(threadPinningMigrationWhen);

      expect(() => migrate(db)).toThrow(
        /Missing applied migration timestamps: 0008_thread_pinning/,
      );
    } finally {
      closeConnection(db);
    }
  });

  it("accepts a published migration row with a released timestamp and historical hash", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);
      replaceAppliedMigrationHash({
        db,
        createdAt: closedSessionPruneIndexesWhen,
        hash: "published-0002-historical-hash",
      });

      expect(() => migrate(db)).not.toThrow();
    } finally {
      closeConnection(db);
    }
  });

  it("accepts the pre-optimization event large values migration hash", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);
      replaceAppliedMigrationHash({
        db,
        createdAt: eventLargeValuesMigrationWhen,
        hash: eventLargeValuesPreOptimizationHash,
      });

      expect(() => migrate(db)).not.toThrow();
    } finally {
      closeConnection(db);
    }
  });

  it("fails clearly before provider-request uniqueness migration when pending interaction duplicates exist", () => {
    const db = createConnection(":memory:");

    try {
      db.$client.exec(`
        CREATE TABLE pending_interactions (
          provider_id text NOT NULL,
          provider_thread_id text NOT NULL,
          provider_request_id text NOT NULL,
          session_id text NOT NULL
        );
        INSERT INTO pending_interactions (
          provider_id,
          provider_thread_id,
          provider_request_id,
          session_id
        )
        VALUES
          ('codex', 'provider-thread-1', 'request-1', 'session-1'),
          ('codex', 'provider-thread-1', 'request-1', 'session-2');
      `);

      expect(() => migrate(db)).toThrow(
        /duplicate provider requests already exist/,
      );
    } finally {
      closeConnection(db);
    }
  });

  it("rejects a non-published migration row with a matching timestamp and wrong hash", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);
      replaceAppliedMigrationHash({
        db,
        createdAt: threadPinningMigrationWhen,
        hash: "non-published-0008-wrong-hash",
      });

      expect(() => migrate(db)).toThrow(
        /Mismatched applied migration hashes: 0008_thread_pinning/,
      );
    } finally {
      closeConnection(db);
    }
  });

  it("backfills queued message sort keys in existing created order", () => {
    const db = createConnection(":memory:");

    try {
      db.$client.exec(`
        CREATE TABLE threads (
          id text PRIMARY KEY NOT NULL
        );
        CREATE TABLE queued_thread_messages (
          id text PRIMARY KEY NOT NULL,
          thread_id text NOT NULL,
          content text NOT NULL,
          model text NOT NULL,
          reasoning_level text NOT NULL,
          permission_mode text NOT NULL,
          service_tier text NOT NULL,
          claimed_at integer,
          claim_token text,
          created_at integer NOT NULL,
          updated_at integer NOT NULL,
          FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE cascade
        );
      `);
      db.$client
        .prepare("INSERT INTO threads (id) VALUES (?), (?)")
        .run("thr_a", "thr_b");
      const insertQueuedMessage =
        db.$client.prepare<QueuedMessageMigrationInsertParameters>(
          `
          INSERT INTO queued_thread_messages (
            id,
            thread_id,
            content,
            model,
            reasoning_level,
            permission_mode,
            service_tier,
            created_at,
            updated_at
          )
          VALUES (?, ?, '[]', 'gpt-5', 'medium', 'full', 'default', ?, ?)
        `,
        );
      insertQueuedMessage.run("qmsg_b", "thr_a", 1_000, 1_000);
      insertQueuedMessage.run("qmsg_a", "thr_a", 1_000, 1_000);
      insertQueuedMessage.run("qmsg_c", "thr_a", 2_000, 2_000);
      insertQueuedMessage.run("qmsg_other", "thr_b", 500, 500);

      runQueuedMessageSortKeyMigration(db);

      expect(
        db.$client
          .prepare<[], MigratedQueuedMessageRow>(
            `
              SELECT id, thread_id AS threadId, sort_key AS sortKey
              FROM queued_thread_messages
              ORDER BY thread_id, sort_key
            `,
          )
          .all(),
      ).toEqual([
        { id: "qmsg_a", threadId: "thr_a", sortKey: "0000000000000001" },
        { id: "qmsg_b", threadId: "thr_a", sortKey: "0000000000000002" },
        { id: "qmsg_c", threadId: "thr_a", sortKey: "0000000000000003" },
        {
          id: "qmsg_other",
          threadId: "thr_b",
          sortKey: "0000000000000001",
        },
      ]);
    } finally {
      closeConnection(db);
    }
  });

  it("backfills project and manager thread sort keys", () => {
    const db = createConnection(":memory:");

    try {
      db.$client.exec(`
        CREATE TABLE projects (
          id text PRIMARY KEY NOT NULL,
          name text NOT NULL,
          created_at integer NOT NULL,
          updated_at integer NOT NULL
        );
        CREATE TABLE threads (
          id text PRIMARY KEY NOT NULL,
          project_id text NOT NULL,
          type text NOT NULL,
          created_at integer NOT NULL
        );
      `);
      const insertProject =
        db.$client.prepare<ProjectSortKeyMigrationInsertParameters>(
          `
            INSERT INTO projects (id, name, created_at, updated_at)
            VALUES (?, ?, ?, ?)
          `,
        );
      insertProject.run("proj_b", "Project B", 1_000, 1_000);
      insertProject.run("proj_a", "Project A", 1_000, 1_000);
      insertProject.run("proj_c", "Project C", 2_000, 2_000);

      const insertThread =
        db.$client.prepare<ThreadSortKeyMigrationInsertParameters>(
          `
            INSERT INTO threads (id, project_id, type, created_at)
            VALUES (?, ?, ?, ?)
          `,
        );
      insertThread.run("thr_manager_b", "proj_a", "manager", 1_000);
      insertThread.run("thr_manager_a", "proj_a", "manager", 2_000);
      insertThread.run("thr_standard", "proj_a", "standard", 3_000);
      insertThread.run("thr_other", "proj_b", "manager", 500);

      runSidebarOrderingMigration(db);

      expect(
        db.$client
          .prepare<[], MigratedProjectRow>(
            `
              SELECT id, sort_key AS sortKey
              FROM projects
              ORDER BY sort_key
            `,
          )
          .all(),
      ).toEqual([
        { id: "proj_a", sortKey: "0000000000000001" },
        { id: "proj_b", sortKey: "0000000000000002" },
        { id: "proj_c", sortKey: "0000000000000003" },
      ]);
      expect(
        db.$client
          .prepare<[], MigratedThreadSortKeyRow>(
            `
              SELECT id, sort_key AS sortKey
              FROM threads
              WHERE project_id = 'proj_a'
              ORDER BY sort_key
            `,
          )
          .all(),
      ).toEqual([
        { id: "thr_standard", sortKey: null },
        { id: "thr_manager_a", sortKey: "0000000000000001" },
        { id: "thr_manager_b", sortKey: "0000000000000002" },
      ]);
    } finally {
      closeConnection(db);
    }
  });

  it("adds nullable thread pinning columns and index", () => {
    const db = createConnection(":memory:");

    try {
      db.$client.exec(`
        CREATE TABLE threads (
          id text PRIMARY KEY NOT NULL,
          project_id text NOT NULL,
          archived_at integer,
          deleted_at integer
        );
      `);

      runThreadPinningMigration(db);

      const columns = db.$client
        .prepare<[], TableInfoRow>("PRAGMA table_info(threads)")
        .all();
      const columnsByName = new Map(
        columns.map((column) => [column.name, column]),
      );
      expect(columnsByName.get("pinned_at")?.notnull).toBe(0);
      expect(columnsByName.get("pin_sort_key")?.notnull).toBe(0);
      expect(readIndexNames({ db, tableName: "threads" })).toContain(
        "threads_pin_sort_idx",
      );
    } finally {
      closeConnection(db);
    }
  });
});
