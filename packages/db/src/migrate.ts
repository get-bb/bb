import { migrate as drizzleMigrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DbConnection } from "./connection.js";
import {
  compatibleMigrationHashes,
  publishedMigrationWhensByTag,
} from "./migration-history.js";

export interface ResolveMigrationsFolderForModuleDirArgs {
  moduleDir: string;
}

interface SqliteTableInfoColumn {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
}

interface SqliteForeignKey {
  table: string;
  from: string;
  to: string;
  onUpdate: string;
  onDelete: string;
}

interface SqliteIndex {
  name: string;
  unique: boolean;
}

interface ExpectedColumn {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
}

interface ExpectedForeignKey {
  name: string;
  table: string;
  from: string;
  to: string;
  onUpdate: string;
  onDelete: string;
}

interface ExpectedIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

interface MigrationJournalEntry {
  tag: string;
  when: number;
}

interface MigrationJournal {
  entries: MigrationJournalEntry[];
}

interface ExpectedAppliedMigration {
  createdAt: number;
  hash: string;
  sql: string[];
  tag: string;
}

type DeferredDestructiveCleanupMigrationTag =
  | "0015_good_lila_cheney"
  | "0016_salty_arclight"
  | "0017_terminal_session_runtime_state_honesty"
  | "0018_natural_crusher_hogan";

type ReorderedCleanupMigrationTag =
  | "0033_drop_cleanup_mode"
  | "0034_drop_stop_requested_at"
  | "0035_warm_kingpin";

export interface FutureAppliedMigration {
  createdAt: number;
  hash: string;
}

export interface FutureAppliedMigrationWarningFields {
  migrations: FutureAppliedMigration[];
  now: number;
}

export interface MigrationWarningLogger {
  warn(fields: FutureAppliedMigrationWarningFields, message: string): void;
}

export interface MigrateOptions {
  /**
   * Apply logical backfills for legacy lifecycle cleanup migrations while
   * leaving large retired tables/columns in place. This keeps startup fast for
   * already-created databases; strict migrations still physically remove those
   * artifacts when this option is omitted.
   */
  deferDestructiveLegacyCleanup?: boolean;
  logger?: MigrationWarningLogger;
}

interface AppliedMigrationRow {
  createdAt: number;
  hash: string;
}

interface AppliedMigrationCreatedAtRow {
  createdAt: number;
}

interface AppliedMigrationIdentityRow {
  createdAt: number | null;
  hash: string;
}

interface ExistingMigrationRow {
  createdAt: number;
}

interface ExistingTableRow {
  name: string;
}

interface PendingInteractionProviderRequestDuplicateRow {
  duplicateCount: number;
  providerId: string;
  providerRequestId: string;
  providerThreadId: string;
}

type AppliedMigrationHistoryViolationReason =
  | "hash-mismatch"
  | "missing-created-at";

interface AppliedMigrationHistoryViolation {
  migration: ExpectedAppliedMigration;
  reason: AppliedMigrationHistoryViolationReason;
}

const migrationModuleFilename = fileURLToPath(import.meta.url);
const migrationModuleDirname = dirname(migrationModuleFilename);
const migrationJournalPath = join("meta", "_journal.json");
const deferredDestructiveCleanupMigrationTags = [
  "0015_good_lila_cheney",
  "0016_salty_arclight",
  "0017_terminal_session_runtime_state_honesty",
  "0018_natural_crusher_hogan",
] as const satisfies readonly DeferredDestructiveCleanupMigrationTag[];
const reorderedCleanupMigrationTags = [
  "0033_drop_cleanup_mode",
  "0034_drop_stop_requested_at",
  "0035_warm_kingpin",
] as const satisfies readonly ReorderedCleanupMigrationTag[];
const pendingInteractionColumns: ExpectedColumn[] = [
  { name: "id", type: "text", notNull: true, primaryKey: true },
  { name: "thread_id", type: "text", notNull: true, primaryKey: false },
  { name: "turn_id", type: "text", notNull: true, primaryKey: false },
  { name: "provider_id", type: "text", notNull: true, primaryKey: false },
  {
    name: "provider_thread_id",
    type: "text",
    notNull: true,
    primaryKey: false,
  },
  {
    name: "provider_request_id",
    type: "text",
    notNull: true,
    primaryKey: false,
  },
  { name: "status", type: "text", notNull: true, primaryKey: false },
  { name: "payload", type: "text", notNull: true, primaryKey: false },
  { name: "resolution", type: "text", notNull: false, primaryKey: false },
  {
    name: "status_reason",
    type: "text",
    notNull: false,
    primaryKey: false,
  },
  { name: "created_at", type: "integer", notNull: true, primaryKey: false },
  { name: "resolved_at", type: "integer", notNull: false, primaryKey: false },
  { name: "updated_at", type: "integer", notNull: true, primaryKey: false },
];
const pendingInteractionForeignKeys: ExpectedForeignKey[] = [
  {
    name: "pending_interactions.thread_id",
    table: "threads",
    from: "thread_id",
    to: "id",
    onUpdate: "NO ACTION",
    onDelete: "CASCADE",
  },
];
const pendingInteractionIndexes: ExpectedIndex[] = [
  {
    name: "pending_interactions_provider_request_idx",
    columns: ["provider_id", "provider_thread_id", "provider_request_id"],
    unique: true,
  },
  {
    name: "pending_interactions_thread_created_idx",
    columns: ["thread_id", "created_at"],
    unique: false,
  },
  {
    name: "pending_interactions_thread_status_created_idx",
    columns: ["thread_id", "status", "created_at"],
    unique: false,
  },
  {
    name: "pending_interactions_status_created_idx",
    columns: ["status", "created_at"],
    unique: false,
  },
];

function hasMigrationJournal(migrationsFolder: string): boolean {
  return existsSync(resolve(migrationsFolder, migrationJournalPath));
}

export function resolveMigrationsFolderForModuleDir(
  args: ResolveMigrationsFolderForModuleDirArgs,
): string {
  const sourcePackageCandidate = resolve(args.moduleDir, "..", "drizzle");
  const bundledAssetCandidate = resolve(args.moduleDir, "drizzle");
  const candidates = [sourcePackageCandidate, bundledAssetCandidate];

  for (const candidate of candidates) {
    if (hasMigrationJournal(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Missing database migrations. Expected ${migrationJournalPath} under one of: ${candidates.join(", ")}`,
  );
}

function resolveMigrationsFolder(): string {
  return resolveMigrationsFolderForModuleDir({
    moduleDir: migrationModuleDirname,
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTableInfoColumn(value: unknown): SqliteTableInfoColumn {
  if (!isObject(value)) {
    throw new Error("Unexpected PRAGMA table_info row shape");
  }

  const name = value.name;
  const type = value.type;
  const notNull = value.notnull;
  const primaryKey = value.pk;
  if (
    typeof name !== "string" ||
    typeof type !== "string" ||
    typeof notNull !== "number" ||
    typeof primaryKey !== "number"
  ) {
    throw new Error("Unexpected PRAGMA table_info column fields");
  }

  return {
    name,
    type: type.toLowerCase(),
    notNull: notNull !== 0,
    primaryKey: primaryKey !== 0,
  };
}

function parseForeignKey(value: unknown): SqliteForeignKey {
  if (!isObject(value)) {
    throw new Error("Unexpected PRAGMA foreign_key_list row shape");
  }

  const table = value.table;
  const from = value.from;
  const to = value.to;
  const onUpdate = value.on_update;
  const onDelete = value.on_delete;
  if (
    typeof table !== "string" ||
    typeof from !== "string" ||
    typeof to !== "string" ||
    typeof onUpdate !== "string" ||
    typeof onDelete !== "string"
  ) {
    throw new Error("Unexpected PRAGMA foreign_key_list fields");
  }

  return {
    table,
    from,
    to,
    onUpdate,
    onDelete,
  };
}

function parseIndex(value: unknown): SqliteIndex {
  if (!isObject(value)) {
    throw new Error("Unexpected PRAGMA index_list row shape");
  }

  const name = value.name;
  const unique = value.unique;
  if (typeof name !== "string" || typeof unique !== "number") {
    throw new Error("Unexpected PRAGMA index_list fields");
  }

  return {
    name,
    unique: unique !== 0,
  };
}

function parseIndexColumnName(value: unknown): string {
  if (!isObject(value) || typeof value.name !== "string") {
    throw new Error("Unexpected PRAGMA index_info row shape");
  }

  return value.name;
}

function parseMigrationJournalEntry(value: unknown): MigrationJournalEntry {
  if (!isObject(value)) {
    throw new Error("Unexpected migration journal entry shape");
  }

  const tag = value.tag;
  const when = value.when;
  if (typeof tag !== "string" || typeof when !== "number") {
    throw new Error("Unexpected migration journal entry fields");
  }

  return { tag, when };
}

function parseMigrationJournal(value: unknown): MigrationJournal {
  if (!isObject(value) || !Array.isArray(value.entries)) {
    throw new Error("Unexpected migration journal shape");
  }

  return {
    entries: value.entries.map(parseMigrationJournalEntry),
  };
}

function readMigrationJournal(migrationsFolder: string): MigrationJournal {
  const journal: unknown = JSON.parse(
    readFileSync(resolve(migrationsFolder, migrationJournalPath), "utf-8"),
  );

  return parseMigrationJournal(journal);
}

function getTableInfo(
  db: DbConnection,
  tableName: string,
): SqliteTableInfoColumn[] {
  const rows = db.$client.pragma(`table_info(${tableName})`);
  if (!Array.isArray(rows)) {
    throw new Error(`Unexpected PRAGMA table_info(${tableName}) result`);
  }

  return rows.map(parseTableInfoColumn);
}

function tableExists(db: DbConnection, tableName: string): boolean {
  return (
    db.$client
      .prepare<[string], ExistingTableRow>(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name = ?
        `,
      )
      .get(tableName) !== undefined
  );
}

function columnExists(
  db: DbConnection,
  tableName: string,
  columnName: string,
): boolean {
  return getTableInfo(db, tableName).some(
    (column) => column.name === columnName,
  );
}

function getForeignKeys(
  db: DbConnection,
  tableName: string,
): SqliteForeignKey[] {
  const rows = db.$client.pragma(`foreign_key_list(${tableName})`);
  if (!Array.isArray(rows)) {
    throw new Error(`Unexpected PRAGMA foreign_key_list(${tableName}) result`);
  }

  return rows.map(parseForeignKey);
}

function getIndexes(db: DbConnection, tableName: string): SqliteIndex[] {
  const rows = db.$client.pragma(`index_list(${tableName})`);
  if (!Array.isArray(rows)) {
    throw new Error(`Unexpected PRAGMA index_list(${tableName}) result`);
  }

  return rows.map(parseIndex);
}

function getIndexColumnNames(db: DbConnection, indexName: string): string[] {
  const rows = db.$client.pragma(`index_info(${indexName})`);
  if (!Array.isArray(rows)) {
    throw new Error(`Unexpected PRAGMA index_info(${indexName}) result`);
  }

  return rows.map(parseIndexColumnName);
}

function indexExists(
  db: DbConnection,
  tableName: string,
  indexName: string,
): boolean {
  return getIndexes(db, tableName).some((index) => index.name === indexName);
}

function readExpectedAppliedMigrations(
  migrationsFolder: string,
): ExpectedAppliedMigration[] {
  const migrationFiles = readMigrationFiles({ migrationsFolder });
  const journal = readMigrationJournal(migrationsFolder);

  if (migrationFiles.length !== journal.entries.length) {
    throw new Error(
      `Migration journal length mismatch: found ${journal.entries.length} journal entries and ${migrationFiles.length} migration files`,
    );
  }

  return migrationFiles.map((migration, index) => {
    const journalEntry = journal.entries[index];
    if (migration.folderMillis !== journalEntry.when) {
      throw new Error(
        `Migration journal timestamp mismatch for ${journalEntry.tag}: journal when=${journalEntry.when}, migration when=${migration.folderMillis}`,
      );
    }

    return {
      createdAt: migration.folderMillis,
      hash: migration.hash,
      sql: migration.sql,
      tag: journalEntry.tag,
    };
  });
}

function readAppliedMigrationCreatedAts(db: DbConnection): Set<number> {
  if (!tableExists(db, "__drizzle_migrations")) {
    return new Set();
  }

  const rows = db.$client
    .prepare<[], AppliedMigrationCreatedAtRow>(
      `
        SELECT created_at AS createdAt
        FROM __drizzle_migrations
        WHERE created_at IS NOT NULL
      `,
    )
    .all();

  return new Set(rows.map((row) => row.createdAt));
}

function requireExpectedAppliedMigration(
  migrations: ExpectedAppliedMigration[],
  tag: string,
): ExpectedAppliedMigration {
  const migration = migrations.find((candidate) => candidate.tag === tag);
  if (migration === undefined) {
    throw new Error(`Missing expected migration metadata for ${tag}`);
  }

  return migration;
}

function markMigrationApplied(
  db: DbConnection,
  migration: ExpectedAppliedMigration,
): void {
  const existingMigration = db.$client
    .prepare<[number], ExistingMigrationRow>(
      `
        SELECT created_at AS createdAt
        FROM __drizzle_migrations
        WHERE created_at = ?
      `,
    )
    .get(migration.createdAt);
  if (existingMigration !== undefined) {
    return;
  }

  db.$client
    .prepare<[string, number]>(
      `
        INSERT INTO __drizzle_migrations (hash, created_at)
        VALUES (?, ?)
      `,
    )
    .run(migration.hash, migration.createdAt);
}

function hasPublishedTimestampFallback(
  expectedMigration: ExpectedAppliedMigration,
  appliedCreatedAts: Set<number>,
): boolean {
  const publishedWhen = publishedMigrationWhensByTag.get(expectedMigration.tag);
  if (publishedWhen !== expectedMigration.createdAt) {
    return false;
  }

  // Published squash-era migrations can already exist with historical hashes.
  // Drizzle uses created_at as its high-water mark, so those released rows must
  // be accepted by their pinned tag/timestamp when the current file hash differs.
  return appliedCreatedAts.has(expectedMigration.createdAt);
}

function hasAppliedMigrationHash(
  expectedMigration: ExpectedAppliedMigration,
  appliedMigrations: AppliedMigrationIdentityRow[],
): boolean {
  return appliedMigrations.some(
    (appliedMigration) =>
      appliedMigration.createdAt === expectedMigration.createdAt &&
      appliedMigration.hash === expectedMigration.hash,
  );
}

function hasCompatibleMigrationHash(
  expectedMigration: ExpectedAppliedMigration,
  appliedMigrations: AppliedMigrationIdentityRow[],
): boolean {
  return compatibleMigrationHashes.some(
    (compatibleMigration) =>
      compatibleMigration.tag === expectedMigration.tag &&
      compatibleMigration.when === expectedMigration.createdAt &&
      appliedMigrations.some(
        (appliedMigration) =>
          appliedMigration.createdAt === expectedMigration.createdAt &&
          appliedMigration.hash === compatibleMigration.hash,
      ),
  );
}

function findAppliedMigrationHistoryViolation(
  expectedMigration: ExpectedAppliedMigration,
  appliedMigrations: AppliedMigrationIdentityRow[],
  appliedCreatedAts: Set<number>,
): AppliedMigrationHistoryViolation | null {
  if (hasAppliedMigrationHash(expectedMigration, appliedMigrations)) {
    return null;
  }

  if (hasCompatibleMigrationHash(expectedMigration, appliedMigrations)) {
    return null;
  }

  if (hasPublishedTimestampFallback(expectedMigration, appliedCreatedAts)) {
    return null;
  }

  const reason: AppliedMigrationHistoryViolationReason = appliedCreatedAts.has(
    expectedMigration.createdAt,
  )
    ? "hash-mismatch"
    : "missing-created-at";

  return {
    migration: expectedMigration,
    reason,
  };
}

function formatExpectedAppliedMigration(
  migration: ExpectedAppliedMigration,
): string {
  return `${migration.tag} (when=${migration.createdAt}, hash=${migration.hash})`;
}

function formatExpectedColumn(column: ExpectedColumn): string {
  return `${column.name} ${column.type} notNull=${column.notNull} primaryKey=${column.primaryKey}`;
}

function formatActualColumn(column: SqliteTableInfoColumn): string {
  return `${column.name} ${column.type} notNull=${column.notNull} primaryKey=${column.primaryKey}`;
}

function validatePendingInteractionsSchema(db: DbConnection): void {
  const columns = getTableInfo(db, "pending_interactions");
  const actualColumnNames = columns.map((column) => column.name);
  const expectedColumnNames = pendingInteractionColumns.map(
    (column) => column.name,
  );
  const missingColumns = expectedColumnNames.filter(
    (column) => !actualColumnNames.includes(column),
  );
  const extraColumns = actualColumnNames.filter(
    (column) => !expectedColumnNames.includes(column),
  );
  const columnMismatches: string[] = [];
  for (const expectedColumn of pendingInteractionColumns) {
    const actualColumn = columns.find(
      (column) => column.name === expectedColumn.name,
    );
    if (actualColumn === undefined) {
      continue;
    }

    if (
      actualColumn.type !== expectedColumn.type ||
      actualColumn.notNull !== expectedColumn.notNull ||
      actualColumn.primaryKey !== expectedColumn.primaryKey
    ) {
      columnMismatches.push(
        `${expectedColumn.name}: expected ${formatExpectedColumn(expectedColumn)}, got ${formatActualColumn(actualColumn)}`,
      );
    }
  }

  const foreignKeys = getForeignKeys(db, "pending_interactions");
  const missingForeignKeys = pendingInteractionForeignKeys.filter(
    (expectedForeignKey) =>
      !foreignKeys.some(
        (foreignKey) =>
          foreignKey.table === expectedForeignKey.table &&
          foreignKey.from === expectedForeignKey.from &&
          foreignKey.to === expectedForeignKey.to &&
          foreignKey.onUpdate === expectedForeignKey.onUpdate &&
          foreignKey.onDelete === expectedForeignKey.onDelete,
      ),
  );

  const indexes = getIndexes(db, "pending_interactions");
  const missingOrMismatchedIndexes: string[] = [];
  for (const expectedIndex of pendingInteractionIndexes) {
    const actualIndex = indexes.find(
      (index) => index.name === expectedIndex.name,
    );
    if (actualIndex === undefined) {
      missingOrMismatchedIndexes.push(`${expectedIndex.name}: missing`);
      continue;
    }

    const actualColumns = getIndexColumnNames(db, expectedIndex.name);
    if (
      actualIndex.unique !== expectedIndex.unique ||
      actualColumns.length !== expectedIndex.columns.length ||
      actualColumns.some(
        (column, index) => column !== expectedIndex.columns[index],
      )
    ) {
      missingOrMismatchedIndexes.push(
        `${expectedIndex.name}: expected unique=${expectedIndex.unique} columns=${expectedIndex.columns.join(",")}, got unique=${actualIndex.unique} columns=${actualColumns.join(",")}`,
      );
    }
  }

  if (
    missingColumns.length > 0 ||
    extraColumns.length > 0 ||
    columnMismatches.length > 0 ||
    missingForeignKeys.length > 0 ||
    missingOrMismatchedIndexes.length > 0
  ) {
    throw new Error(
      [
        "Database schema drift detected for pending_interactions after migration.",
        missingColumns.length > 0
          ? `Missing columns: ${missingColumns.join(", ")}.`
          : null,
        extraColumns.length > 0
          ? `Unexpected columns: ${extraColumns.join(", ")}.`
          : null,
        columnMismatches.length > 0
          ? `Column mismatches: ${columnMismatches.join("; ")}.`
          : null,
        missingForeignKeys.length > 0
          ? `Missing foreign keys: ${missingForeignKeys.map((foreignKey) => foreignKey.name).join(", ")}.`
          : null,
        missingOrMismatchedIndexes.length > 0
          ? `Missing or mismatched indexes: ${missingOrMismatchedIndexes.join("; ")}.`
          : null,
        "This usually means the local DB was created by an incompatible prelaunch migration history. Restart BB so migrations can run; if this persists in development, back up the DB and run pnpm reset:dev.",
      ]
        .filter((line): line is string => line !== null)
        .join(" "),
    );
  }
}

function assertNoDuplicatePendingInteractionProviderRequests(
  db: DbConnection,
): void {
  const columnNames = getTableInfo(db, "pending_interactions").map(
    (column) => column.name,
  );
  if (
    !columnNames.includes("provider_id") ||
    !columnNames.includes("provider_thread_id") ||
    !columnNames.includes("provider_request_id")
  ) {
    return;
  }

  const duplicates = db.$client
    .prepare<[], PendingInteractionProviderRequestDuplicateRow>(
      `
        SELECT
          provider_id AS providerId,
          provider_thread_id AS providerThreadId,
          provider_request_id AS providerRequestId,
          COUNT(*) AS duplicateCount
        FROM pending_interactions
        GROUP BY provider_id, provider_thread_id, provider_request_id
        HAVING COUNT(*) > 1
        ORDER BY duplicateCount DESC, provider_id, provider_thread_id, provider_request_id
        LIMIT 10
      `,
    )
    .all();
  if (duplicates.length === 0) {
    return;
  }

  throw new Error(
    [
      "Cannot migrate pending_interactions provider request uniqueness because duplicate provider requests already exist.",
      "Provider request identity is now provider_id/provider_thread_id/provider_request_id independent of session_id.",
      `Resolve duplicate pending_interactions rows before restarting. Duplicates: ${duplicates
        .map(
          (row) =>
            `${row.providerId}/${row.providerThreadId}/${row.providerRequestId} count=${row.duplicateCount}`,
        )
        .join("; ")}.`,
    ].join(" "),
  );
}

function applyDeferredOperationStateBackfill(db: DbConnection): void {
  if (!columnExists(db, "projects", "deleted_at")) {
    db.$client.prepare("ALTER TABLE projects ADD deleted_at integer").run();
  }

  if (tableExists(db, "project_operations")) {
    db.$client
      .prepare(
        `
          UPDATE projects
          SET deleted_at = (
            SELECT project_operations.requested_at
            FROM project_operations
            WHERE project_operations.project_id = projects.id
              AND project_operations.kind = 'delete'
              AND project_operations.state IN ('requested', 'queued')
            ORDER BY project_operations.requested_at ASC
            LIMIT 1
          )
          WHERE EXISTS (
            SELECT 1
            FROM project_operations
            WHERE project_operations.project_id = projects.id
              AND project_operations.kind = 'delete'
              AND project_operations.state IN ('requested', 'queued')
          )
        `,
      )
      .run();
  }

  if (tableExists(db, "thread_operations")) {
    db.$client
      .prepare(
        `
          UPDATE threads
          SET status = 'error'
          WHERE EXISTS (
            SELECT 1
            FROM thread_operations
            WHERE thread_operations.thread_id = threads.id
              AND thread_operations.kind = 'provision'
              AND thread_operations.state IN ('requested', 'queued')
          )
            AND threads.status IN ('created', 'provisioning')
        `,
      )
      .run();

    db.$client
      .prepare(
        `
          UPDATE threads
          SET stop_requested_at = COALESCE(stop_requested_at, (
            SELECT thread_operations.requested_at
            FROM thread_operations
            WHERE thread_operations.thread_id = threads.id
              AND thread_operations.kind = 'stop'
              AND thread_operations.state IN ('requested', 'queued')
            ORDER BY thread_operations.requested_at DESC
            LIMIT 1
          ))
          WHERE stop_requested_at IS NOT NULL
            OR EXISTS (
              SELECT 1
              FROM thread_operations
              WHERE thread_operations.thread_id = threads.id
                AND thread_operations.kind = 'stop'
                AND thread_operations.state IN ('requested', 'queued')
            )
        `,
      )
      .run();

    db.$client
      .prepare(
        `
          INSERT OR IGNORE INTO events (
            id,
            thread_id,
            environment_id,
            scope_kind,
            turn_id,
            provider_thread_id,
            sequence,
            type,
            item_id,
            item_kind,
            data,
            created_at
          )
          SELECT
            'evt_' || thread_operations.id,
            thread_operations.thread_id,
            threads.environment_id,
            'thread',
            NULL,
            NULL,
            COALESCE((
              SELECT MAX(existing_events.sequence)
              FROM events AS existing_events
              WHERE existing_events.thread_id = thread_operations.thread_id
            ), 0) + 1,
            'system/thread/interrupted',
            NULL,
            NULL,
            json_object(
              'reason',
              CASE json_extract(thread_operations.payload, '$.interruptionReason')
                WHEN 'manual-stop' THEN 'manual-stop'
                WHEN 'host-daemon-restarted' THEN 'host-daemon-restarted'
                WHEN 'provider-turn-idle' THEN 'provider-turn-idle'
                ELSE 'manual-stop'
              END
            ),
            thread_operations.requested_at
          FROM thread_operations
          INNER JOIN threads ON threads.id = thread_operations.thread_id
          WHERE thread_operations.kind = 'stop'
            AND thread_operations.state IN ('requested', 'queued')
        `,
      )
      .run();
  }

  if (tableExists(db, "environment_operations")) {
    db.$client
      .prepare(
        `
          UPDATE environments
          SET status = 'error'
          WHERE environments.status = 'provisioning'
            AND EXISTS (
              SELECT 1
              FROM environment_operations
              WHERE environment_operations.environment_id = environments.id
                AND environment_operations.kind IN ('provision', 'reprovision')
                AND environment_operations.state IN ('requested', 'queued')
            )
        `,
      )
      .run();
  }

  if (!indexExists(db, "projects", "projects_deleted_idx")) {
    db.$client
      .prepare("CREATE INDEX projects_deleted_idx ON projects (deleted_at)")
      .run();
  }
}

function applyDeferredDestructiveLegacyCleanup(
  db: DbConnection,
  migrationsFolder: string,
): void {
  if (
    !tableExists(db, "__drizzle_migrations") ||
    !tableExists(db, "projects")
  ) {
    return;
  }

  const expectedMigrations = readExpectedAppliedMigrations(migrationsFolder);
  const appliedCreatedAts = readAppliedMigrationCreatedAts(db);

  const cleanupMigrations = deferredDestructiveCleanupMigrationTags.map((tag) =>
    requireExpectedAppliedMigration(expectedMigrations, tag),
  );
  const hasPendingCleanupMigration = cleanupMigrations.some(
    (migration) => !appliedCreatedAts.has(migration.createdAt),
  );
  if (!hasPendingCleanupMigration) {
    return;
  }

  const operationBackfillMigration = requireExpectedAppliedMigration(
    expectedMigrations,
    "0015_good_lila_cheney",
  );
  if (!appliedCreatedAts.has(operationBackfillMigration.createdAt)) {
    applyDeferredOperationStateBackfill(db);
    markMigrationApplied(db, operationBackfillMigration);
    appliedCreatedAts.add(operationBackfillMigration.createdAt);
  }

  for (const migration of cleanupMigrations) {
    if (appliedCreatedAts.has(migration.createdAt)) {
      continue;
    }

    markMigrationApplied(db, migration);
    appliedCreatedAts.add(migration.createdAt);
  }
}

function applyReorderedCleanupMigration(
  db: DbConnection,
  tag: ReorderedCleanupMigrationTag,
): void {
  switch (tag) {
    case "0033_drop_cleanup_mode": {
      if (
        tableExists(db, "environments") &&
        columnExists(db, "environments", "cleanup_mode")
      ) {
        db.$client
          .prepare("ALTER TABLE `environments` DROP COLUMN `cleanup_mode`")
          .run();
      }
      return;
    }
    case "0034_drop_stop_requested_at": {
      if (
        tableExists(db, "threads") &&
        columnExists(db, "threads", "stop_requested_at")
      ) {
        db.$client
          .prepare("ALTER TABLE `threads` DROP COLUMN `stop_requested_at`")
          .run();
      }
      return;
    }
    case "0035_warm_kingpin": {
      if (tableExists(db, "environments")) {
        if (columnExists(db, "environments", "cleanup_requested_at")) {
          db.$client
            .prepare(
              `
                UPDATE environments
                SET status = 'retiring'
                WHERE status = 'ready'
                  AND cleanup_requested_at IS NOT NULL
              `,
            )
            .run();
        }
        if (
          indexExists(db, "environments", "environments_cleanup_requested_idx")
        ) {
          db.$client
            .prepare("DROP INDEX `environments_cleanup_requested_idx`")
            .run();
        }
        if (columnExists(db, "environments", "cleanup_requested_at")) {
          db.$client
            .prepare(
              "ALTER TABLE `environments` DROP COLUMN `cleanup_requested_at`",
            )
            .run();
        }
      }
      if (tableExists(db, "threads")) {
        db.$client
          .prepare(
            `
              UPDATE threads
              SET status = 'starting'
              WHERE status IN ('created', 'provisioning')
            `,
          )
          .run();
      }
      return;
    }
  }
}

function applyReorderedCleanupMigrations(
  db: DbConnection,
  migrationsFolder: string,
): void {
  if (!tableExists(db, "__drizzle_migrations")) {
    return;
  }

  const expectedMigrations = readExpectedAppliedMigrations(migrationsFolder);
  const appliedCreatedAts = readAppliedMigrationCreatedAts(db);
  for (const tag of reorderedCleanupMigrationTags) {
    const migration = requireExpectedAppliedMigration(expectedMigrations, tag);
    if (appliedCreatedAts.has(migration.createdAt)) {
      continue;
    }
    applyReorderedCleanupMigration(db, tag);
    markMigrationApplied(db, migration);
    appliedCreatedAts.add(migration.createdAt);
  }
}

function warnAboutFutureAppliedMigrations(
  db: DbConnection,
  options: MigrateOptions,
): void {
  if (!options.logger) {
    return;
  }

  const now = Date.now();
  const migrations = db.$client
    .prepare<[number], AppliedMigrationRow>(
      `
        SELECT hash, created_at AS createdAt
        FROM __drizzle_migrations
        WHERE created_at IS NOT NULL
          AND created_at > ?
        ORDER BY created_at
      `,
    )
    .all(now);

  if (migrations.length === 0) {
    return;
  }

  options.logger.warn(
    {
      migrations,
      now,
    },
    "Applied database migrations have future timestamps",
  );
}

function validateAppliedMigrationHistory(
  db: DbConnection,
  migrationsFolder: string,
): void {
  const expectedMigrations = readExpectedAppliedMigrations(migrationsFolder);
  const appliedMigrations = db.$client
    .prepare<[], AppliedMigrationIdentityRow>(
      `
        SELECT hash, created_at AS createdAt
        FROM __drizzle_migrations
      `,
    )
    .all();
  const appliedCreatedAts = new Set(
    appliedMigrations
      .map((migration) => migration.createdAt)
      .filter((createdAt): createdAt is number => createdAt !== null),
  );
  const historyViolations = expectedMigrations
    .map((migration) =>
      findAppliedMigrationHistoryViolation(
        migration,
        appliedMigrations,
        appliedCreatedAts,
      ),
    )
    .filter(
      (violation): violation is AppliedMigrationHistoryViolation =>
        violation !== null,
    );

  if (historyViolations.length === 0) {
    return;
  }

  const missingCreatedAtViolations = historyViolations.filter(
    (violation) => violation.reason === "missing-created-at",
  );
  const hashMismatchViolations = historyViolations.filter(
    (violation) => violation.reason === "hash-mismatch",
  );

  throw new Error(
    [
      "Database migration history is incomplete after migration.",
      missingCreatedAtViolations.length > 0
        ? `Missing applied migration timestamps: ${missingCreatedAtViolations
            .map((violation) =>
              formatExpectedAppliedMigration(violation.migration),
            )
            .join("; ")}.`
        : null,
      hashMismatchViolations.length > 0
        ? `Mismatched applied migration hashes: ${hashMismatchViolations
            .map((violation) =>
              formatExpectedAppliedMigration(violation.migration),
            )
            .join("; ")}.`
        : null,
      missingCreatedAtViolations.length > 0
        ? "Missing timestamps usually mean Drizzle skipped a migration because its journal timestamp is not newer than the latest applied migration."
        : null,
      hashMismatchViolations.length > 0
        ? "Hash mismatches mean the migration ledger row exists at that timestamp but does not match the current migration file."
        : null,
    ]
      .filter((line): line is string => line !== null)
      .join(" "),
  );
}

export function migrate(db: DbConnection, options: MigrateOptions = {}): void {
  const migrationsFolder = resolveMigrationsFolder();
  const sqlite = db.$client;

  sqlite.pragma("foreign_keys = OFF");
  try {
    assertNoDuplicatePendingInteractionProviderRequests(db);
    if (options.deferDestructiveLegacyCleanup === true) {
      applyDeferredDestructiveLegacyCleanup(db, migrationsFolder);
    }
    drizzleMigrate(db, { migrationsFolder });
    applyReorderedCleanupMigrations(db, migrationsFolder);
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }

  warnAboutFutureAppliedMigrations(db, options);
  validateAppliedMigrationHistory(db, migrationsFolder);
  validatePendingInteractionsSchema(db);
}
