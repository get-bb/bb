import { defaultAppSettings, type ThreadEventType } from "@bb/domain";
import { performance } from "node:perf_hooks";
import {
  deletePluginRecommendationId,
  forgetPluginProviders,
  getAiServiceSelections,
  getAppKeybindingOverrides,
  getAppSettings,
  getAutoAppUpdate,
  getDisabledPluginProviderCatalog,
  getDisabledProviderIds,
  getPluginRecommendationId,
  getPluginSafeMode,
  getSkippedAppUpdate,
  isAppUpdateSendHoldSet,
  setAiServiceSelection,
  setAppKeybindingOverrides,
  setAppSettings,
  setAppUpdateSendHold,
  setAutoAppUpdate,
  setDisabledPluginProviderCatalog,
  setDisabledProviderIds,
  setPluginRecommendationId,
  setPluginSafeMode,
  setSkippedAppUpdate,
} from "../../src/data/app-settings.js";
import {
  getStoredFaviconColor,
  getStoredThemeId,
  setStoredAppearance,
} from "../../src/data/app-theme.js";
import { getExperiments, setExperiments } from "../../src/data/experiments.js";
import {
  dropDeferredLegacyTables,
  getDatabaseAutoVacuumMode,
  getDatabaseFreelistStats,
  getDatabaseMaintenanceActivity,
  listDeferredLegacyTables,
  runIncrementalVacuum,
} from "../../src/data/maintenance.js";
import {
  createPendingInteraction,
  getActivePendingInteractionForThread,
  getPendingInteraction,
  getPendingInteractionByProviderRequest,
  hasTurnBoundActivePendingInteractionForThread,
  interruptPendingInteractionsForPlugin,
  interruptPendingInteractionsForThreadIds,
  interruptPendingInteractionsForThreads,
  listActivePluginPendingInteractions,
  listActiveProviderPendingInteractionsForHost,
  listPendingInteractionsByThread,
  setPendingInteractionInterrupted,
  setPendingInteractionResolved,
  setPendingInteractionResolving,
} from "../../src/data/pending-interactions.js";
import {
  deleteStoredProviderModelCatalogsForHost,
  getStoredProviderModelCatalog,
  replaceStoredProviderModelCatalog,
  type StoredProviderModelCatalog,
} from "../../src/data/provider-model-catalogs.js";
import { pruneRateLimitSnapshotWindow } from "../../src/data/rate-limit-pruning.js";
import {
  advanceLiveEventPruning,
  rewindResolvedItemPruning,
} from "../../src/data/resolved-item-pruning.js";
import {
  canHydrateRetainedEventOutputRowsWithinDataByteLimit,
  copyRetainedEventOutputs,
  deleteExpiredRetainedEventOutputs,
  hydrateRetainedEventOutputRows,
  hydrateRetainedEventOutputRowsWithinDataByteLimit,
  insertPreparedRetainedEventOutput,
} from "../../src/data/retained-event-outputs.js";
import {
  CLOSED_SESSION_ROW_RETENTION_MS,
  DEFAULT_CLOSED_SESSION_PRUNE_BATCH_SIZE,
  DEFAULT_COMPLETED_EVENT_OUTPUT_MIGRATION_SCAN_LIMIT,
  DEFAULT_LEGACY_IMAGE_GENERATION_MIGRATION_SCAN_LIMIT,
  migrateNextCompletedEventItemOutput,
  migrateNextLegacyImageGenerationOutput,
  pruneClosedSessions,
} from "../../src/data/sweeps.js";
import { listHostThreadIds } from "../../src/data/threads.js";
import {
  deleteSweepItemFailures,
  deleteSweepItemFailuresOfUnknownSweeps,
  getSweepItemFailure,
  listSweepItemFailures,
  upsertSweepItemFailure,
} from "../../src/data/sweep-item-failures.js";
import { THREAD_PRUNING_ADVANCE_WORK_BUDGET_MS } from "../../src/data/thread-pruning.js";
import {
  getStoredUiPreferenceDefault,
  listStoredUiPreferenceDefaults,
  listStoredUiPreferences,
  overwriteStoredUiPreference,
  replaceStoredUiPreference,
} from "../../src/data/ui-preferences.js";
import {
  events,
  maintenanceScanCursors,
  threadPruningCursors,
} from "../../src/schema.js";
import type { DbConnection } from "../../src/connection.js";
import type { HistoryFixture, HistoryTurn } from "../../src/history-fixture.js";
import { desc, eq } from "drizzle-orm";
import { registerCostGroup, type QueryCostCase } from "./case.js";
import {
  BUSIEST_PLUGIN_ID,
  ITEM_SWEEPS,
  KNOWN_SWEEPS,
  PROVIDER_IDS,
  RETAINED_OUTPUT_VALUE,
  UI_PREFERENCE_KEYS,
  keybindingOverrides,
  seedSettingsMaintenance,
  type SettingsMaintenanceSeed,
} from "./settings-maintenance-seed.js";

const DATA = "packages/db/src/data";
const APP_SETTINGS = `${DATA}/app-settings.ts`;
const APP_THEME = `${DATA}/app-theme.ts`;
const EXPERIMENTS = `${DATA}/experiments.ts`;
const UI_PREFERENCES = `${DATA}/ui-preferences.ts`;
const MAINTENANCE = `${DATA}/maintenance.ts`;
const RATE_LIMIT_PRUNING = `${DATA}/rate-limit-pruning.ts`;
const RESOLVED_ITEM_PRUNING = `${DATA}/resolved-item-pruning.ts`;
const RETAINED_EVENT_OUTPUTS = `${DATA}/retained-event-outputs.ts`;
const SWEEPS = `${DATA}/sweeps.ts`;
const SWEEP_ITEM_FAILURES = `${DATA}/sweep-item-failures.ts`;
const PENDING_INTERACTIONS = `${DATA}/pending-interactions.ts`;
const PROVIDER_MODEL_CATALOGS = `${DATA}/provider-model-catalogs.ts`;

const SWEEP_BATCH_SIZE = 500;
const RATE_LIMIT_CHUNK_SIZE = 16;
const RETAINED_OUTPUT_EXPIRY_BATCH_SIZE = 1;
const TIMELINE_WINDOW_EVENT_BUDGET = 1_500;
const WORKSPACE_CATALOG_RETENTION_MS = 7 * 24 * 60 * 60_000;
const RESTING_CURSOR_VERSION = 2;
const LAST_PASS_HISTORY_FRACTION = 0.5;
const INCREMENTAL_VACUUM_CHUNK_PAGES = 256;
const TIMELINE_EVENT_DATA_BYTE_LIMIT = 4 * 1024 * 1024;
const THREAD_EVENT_RESPONSE_DATA_BYTE_LIMIT = 8 * 1024 * 1024;
const MIGRATION_CURSOR_VERSION = 1;
const COMMAND_OUTPUT_TARGET = {
  itemKind: "commandExecution",
  outputPath: "aggregatedOutput",
} as const;
const IMAGE_OUTPUT_TARGET = {
  itemKind: "imageGeneration",
  outputPath: "result",
} as const;

type Case = QueryCostCase<SettingsMaintenanceSeed>;

function turnAt(fixture: HistoryFixture, index: number): HistoryTurn {
  const turn = fixture.turns.at(index);
  if (turn === undefined) throw new Error(`Expected history turn ${index}`);
  return turn;
}

function lastTurn(fixture: HistoryFixture): HistoryTurn {
  return turnAt(fixture, -1);
}

function restResolvedItemCursors(
  db: DbConnection,
  fixture: HistoryFixture,
  provenThrough: number,
): void {
  for (const policy of ["deltas", "background"]) {
    db.insert(threadPruningCursors)
      .values({
        policy,
        scope: fixture.threadId,
        threadId: fixture.threadId,
        version: RESTING_CURSOR_VERSION,
        sequence: provenThrough,
        upperSequence: provenThrough,
        updatedAt: Date.now(),
      })
      .run();
  }
}

let timelineWindowRows: { id: string; type: ThreadEventType; data: string }[] =
  [];
let uiPreferenceRevision = 0;
let hostThreadIds: string[] = [];

function readTimelineWindowRows(
  db: DbConnection,
  fixture: HistoryFixture,
): void {
  timelineWindowRows = db
    .select({ id: events.id, type: events.type, data: events.data })
    .from(events)
    .where(eq(events.threadId, fixture.threadId))
    .orderBy(desc(events.sequence))
    .limit(TIMELINE_WINDOW_EVENT_BUDGET)
    .all()
    .reverse();
}

function positionMigrationCursor(
  db: DbConnection,
  args: {
    policy: string;
    target: {
      itemKind: "commandExecution" | "imageGeneration";
      outputPath: string;
    };
    lastCreatedAt: number;
    lastEventId: string;
  },
): void {
  db.insert(maintenanceScanCursors)
    .values({
      id: [
        args.policy,
        `v${MIGRATION_CURSOR_VERSION}`,
        args.target.itemKind,
        args.target.outputPath,
      ].join(":"),
      policy: args.policy,
      version: MIGRATION_CURSOR_VERSION,
      itemKind: args.target.itemKind,
      outputPath: args.target.outputPath,
      lastCreatedAt: args.lastCreatedAt,
      lastEventId: args.lastEventId,
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: [
        maintenanceScanCursors.policy,
        maintenanceScanCursors.version,
        maintenanceScanCursors.itemKind,
        maintenanceScanCursors.outputPath,
      ],
      set: {
        lastCreatedAt: args.lastCreatedAt,
        lastEventId: args.lastEventId,
        updatedAt: Date.now(),
      },
    })
    .run();
}

function positionCommandMigrationBefore(
  db: DbConnection,
  eventId: string,
): void {
  const previous = db.$client
    .prepare<[string], { created_at: number; id: string }>(
      `SELECT created_at, id FROM events
        WHERE type = 'item/completed' AND item_kind = 'commandExecution'
          AND (created_at, id) < (SELECT created_at, id FROM events WHERE id = ?)
        ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(eventId);
  if (previous === undefined) {
    throw new Error("Expected a completed command before the legacy row");
  }
  positionMigrationCursor(db, {
    policy: "legacy_completed_event_output_sidecar",
    target: COMMAND_OUTPUT_TARGET,
    lastCreatedAt: previous.created_at,
    lastEventId: previous.id,
  });
}

function positionImageMigrationBefore(db: DbConnection, eventId: string): void {
  const previous = db.$client
    .prepare<[string], { id: string | null }>(
      "SELECT max(id) AS id FROM events WHERE id < ?",
    )
    .get(eventId);
  if (previous?.id == null) {
    throw new Error("Expected an event before the legacy image row");
  }
  positionMigrationCursor(db, {
    policy: "legacy_image_generation_output_sidecar",
    target: IMAGE_OUTPUT_TARGET,
    lastCreatedAt: 0,
    lastEventId: previous.id,
  });
}
let storedCatalog: StoredProviderModelCatalog | null = null;

const SETTINGS_CASES: readonly Case[] = [
  {
    name: `${APP_SETTINGS}#getAppSettings`,
    run: (db) => getAppSettings(db),
  },
  {
    name: `${APP_SETTINGS}#setAppSettings`,
    run: (db) =>
      setAppSettings(db, {
        ...defaultAppSettings,
        providerOrder: [...PROVIDER_IDS].reverse(),
        defaultProviderId: PROVIDER_IDS[1],
        streamerMode: false,
        earlyAdopter: true,
      }),
  },
  {
    name: `${APP_SETTINGS}#getAppKeybindingOverrides`,
    run: (db) => getAppKeybindingOverrides(db),
  },
  {
    name: `${APP_SETTINGS}#setAppKeybindingOverrides`,
    run: (db) => setAppKeybindingOverrides(db, keybindingOverrides().slice(1)),
  },
  {
    name: `${APP_SETTINGS}#setAiServiceSelection`,
    run: (db) =>
      setAiServiceSelection(db, "commit-message", {
        mode: "service",
        pluginId: "bb-cloud",
        serviceId: "commit-messages",
      }),
  },
  {
    name: `${APP_SETTINGS}#setPluginSafeMode`,
    run: (db) => setPluginSafeMode(db, true),
  },
  {
    name: `${APP_SETTINGS}#setDisabledProviderIds`,
    run: (db) =>
      setDisabledProviderIds(db, [
        "opencode",
        "provider-c",
        "plugin:slack/assistant",
      ]),
  },
  {
    name: `${APP_SETTINGS}#setDisabledPluginProviderCatalog`,
    run: (db) =>
      setDisabledPluginProviderCatalog(db, BUSIEST_PLUGIN_ID, [
        { id: `${BUSIEST_PLUGIN_ID}-assistant`, displayName: "PR assistant" },
        { id: `${BUSIEST_PLUGIN_ID}-reviewer`, displayName: "PR reviewer" },
        { id: `${BUSIEST_PLUGIN_ID}-triage`, displayName: "PR triage" },
      ]),
  },
  {
    name: `${APP_SETTINGS}#setPluginRecommendationId`,
    run: (db) =>
      setPluginRecommendationId(db, "plugin-0", "recommendation-next"),
  },
  {
    name: `${APP_SETTINGS}#setSkippedAppUpdate`,
    run: (db) => setSkippedAppUpdate(db, "2026.11.2"),
  },
  {
    name: `${APP_SETTINGS}#setAutoAppUpdate`,
    run: (db) => setAutoAppUpdate(db, false),
  },
  {
    name: `${APP_SETTINGS}#getAiServiceSelections`,
    run: (db) => getAiServiceSelections(db),
  },
  {
    name: `${APP_SETTINGS}#getPluginSafeMode`,
    run: (db) => getPluginSafeMode(db),
  },
  {
    name: `${APP_SETTINGS}#getDisabledProviderIds`,
    run: (db) => getDisabledProviderIds(db),
  },
  {
    name: `${APP_SETTINGS}#getDisabledPluginProviderCatalog`,
    run: (db) => getDisabledPluginProviderCatalog(db, BUSIEST_PLUGIN_ID),
  },
  {
    name: `${APP_SETTINGS}#forgetPluginProviders`,
    run: (db) =>
      forgetPluginProviders(
        db,
        BUSIEST_PLUGIN_ID,
        new Set([
          `${BUSIEST_PLUGIN_ID}-assistant`,
          `${BUSIEST_PLUGIN_ID}-reviewer`,
        ]),
      ),
  },
  {
    name: `${APP_SETTINGS}#getPluginRecommendationId`,
    run: (db) => getPluginRecommendationId(db, "plugin-0"),
  },
  {
    name: `${APP_SETTINGS}#deletePluginRecommendationId`,
    run: (db) => deletePluginRecommendationId(db, "plugin-0"),
  },
  {
    name: `${APP_SETTINGS}#isAppUpdateSendHoldSet`,
    run: (db) => isAppUpdateSendHoldSet(db),
  },
  {
    name: `${APP_SETTINGS}#setAppUpdateSendHold`,
    run: (db) => setAppUpdateSendHold(db, true),
  },
  {
    name: `${APP_SETTINGS}#getSkippedAppUpdate`,
    run: (db) => getSkippedAppUpdate(db),
  },
  {
    name: `${APP_SETTINGS}#getAutoAppUpdate`,
    run: (db) => getAutoAppUpdate(db),
  },
  {
    name: `${APP_THEME}#getStoredThemeId`,
    run: (db) => getStoredThemeId(db),
  },
  {
    name: `${APP_THEME}#getStoredFaviconColor`,
    run: (db) => getStoredFaviconColor(db),
  },
  {
    name: `${APP_THEME}#setStoredAppearance`,
    run: (db) =>
      setStoredAppearance(db, {
        themeId: "github-light",
        faviconColor: "default",
      }),
  },
  {
    name: `${EXPERIMENTS}#getExperiments`,
    run: (db) => getExperiments(db),
  },
  {
    name: `${EXPERIMENTS}#setExperiments`,
    run: (db) =>
      setExperiments(db, {
        agentCpuPriority: false,
        compactExpiredCache: true,
        dismissReadNotifications: true,
        serverMove: false,
        performanceDiagnostics: true,
        pluginUpdates: true,
        resumeThreadsAfterRestart: true,
        skipFocusedThreadNotifications: true,
        threadContextCard: true,
        threadRowMetadata: true,
        updateWhenIdle: true,
        walCheckpointWorker: true,
      }),
  },
  {
    name: `${UI_PREFERENCES}#listStoredUiPreferences`,
    run: (db) => listStoredUiPreferences(db),
  },
  {
    name: `${UI_PREFERENCES}#listStoredUiPreferenceDefaults`,
    run: (db) => listStoredUiPreferenceDefaults(db),
  },
  {
    name: `${UI_PREFERENCES}#getStoredUiPreferenceDefault`,
    run: (db) => getStoredUiPreferenceDefault(db, UI_PREFERENCE_KEYS[0]),
  },
  {
    name: `${UI_PREFERENCES}#replaceStoredUiPreference`,
    prepare: (db) => {
      uiPreferenceRevision =
        listStoredUiPreferences(db).find(
          (row) => row.key === "sidebar.hiddenGroups",
        )?.revision ?? 0;
    },
    run: (db) =>
      replaceStoredUiPreference(db, {
        expectedRevision: uiPreferenceRevision,
        key: "sidebar.hiddenGroups",
        valueJson: JSON.stringify(
          Array.from({ length: 41 }, (_, index) => `project:${index}`),
        ),
      }),
  },
  {
    name: `${UI_PREFERENCES}#overwriteStoredUiPreference`,
    run: (db) =>
      overwriteStoredUiPreference(db, {
        key: "sidebar.manualSectionOrder",
        valueJson: JSON.stringify(
          Array.from({ length: 40 }, (_, index) => `section:${index}`),
        ),
      }),
  },
];

const MAINTENANCE_CASES: readonly Case[] = [
  {
    name: `${MAINTENANCE}#getDatabaseMaintenanceActivity`,
    run: (db) => getDatabaseMaintenanceActivity(db),
  },
  {
    name: `${MAINTENANCE}#listDeferredLegacyTables`,
    run: (db) => listDeferredLegacyTables(db),
  },
  {
    name: `${MAINTENANCE}#dropDeferredLegacyTables`,
    run: (db) => dropDeferredLegacyTables(db),
  },
  {
    name: `${MAINTENANCE}#getDatabaseFreelistStats`,
    prepare: (db) => {
      dropDeferredLegacyTables(db);
    },
    run: (db) => getDatabaseFreelistStats(db.$client),
  },
  {
    name: `${MAINTENANCE}#runIncrementalVacuum`,
    prepare: (db) => {
      dropDeferredLegacyTables(db);
    },
    run: (db) =>
      runIncrementalVacuum(db.$client, {
        maxPages: INCREMENTAL_VACUUM_CHUNK_PAGES,
      }),
  },
  {
    name: `${MAINTENANCE}#getDatabaseAutoVacuumMode`,
    run: (db) => getDatabaseAutoVacuumMode(db.$client),
  },
  {
    name: `${RATE_LIMIT_PRUNING}#pruneRateLimitSnapshotWindow`,
    run: (db, _fixture, seed) =>
      db.transaction((tx) =>
        pruneRateLimitSnapshotWindow(tx, {
          threadId: seed.rateLimitThreadId,
          afterSequence: 0,
          throughSequence: seed.rateLimitLatestSequence - 1,
          limit: RATE_LIMIT_CHUNK_SIZE,
        }),
      ),
  },
  {
    name: `${RESOLVED_ITEM_PRUNING}#rewindResolvedItemPruning`,
    prepare: (db, fixture) => {
      restResolvedItemCursors(db, fixture, fixture.latestSequence - 1);
    },
    run: (db, fixture) =>
      db.transaction((tx) =>
        rewindResolvedItemPruning(tx, {
          threadId: fixture.threadId,
          beforeSequence: lastTurn(fixture).requestSequence,
        }),
      ),
  },
  {
    name: `${RESOLVED_ITEM_PRUNING}#advanceLiveEventPruning`,
    prepare: (db, fixture) => {
      const lastPassTurn = Math.floor(
        fixture.turns.length * LAST_PASS_HISTORY_FRACTION,
      );
      restResolvedItemCursors(
        db,
        fixture,
        turnAt(fixture, lastPassTurn).completedSequence,
      );
    },
    run: (db, fixture) =>
      db.transaction((tx) =>
        advanceLiveEventPruning(tx, {
          threadId: fixture.threadId,
          kind: "deltas",
          limit: SWEEP_BATCH_SIZE,
          deadline: performance.now() + THREAD_PRUNING_ADVANCE_WORK_BUDGET_MS,
        }),
      ),
  },
  {
    name: `${RETAINED_EVENT_OUTPUTS}#insertPreparedRetainedEventOutput`,
    run: (db, _fixture, seed) =>
      insertPreparedRetainedEventOutput(db, {
        eventId: seed.unretainedEventId,
        output: {
          expiresAt: Date.now() + 7 * 24 * 60 * 60_000,
          outputPath: "aggregatedOutput",
          value: RETAINED_OUTPUT_VALUE,
        },
      }),
  },
  {
    name: `${RETAINED_EVENT_OUTPUTS}#copyRetainedEventOutputs`,
    run: (db, _fixture, seed) =>
      copyRetainedEventOutputs(db, {
        copiedAt: Date.now(),
        events: seed.copyTargetEventIds.map((targetEventId, index) => {
          const sourceEventId = seed.liveRetainedEventIds[index];
          if (sourceEventId === undefined) {
            throw new Error("Expected a retained output to copy");
          }
          return { sourceEventId, targetEventId };
        }),
      }),
  },
  {
    name: `${RETAINED_EVENT_OUTPUTS}#hydrateRetainedEventOutputRows`,
    prepare: readTimelineWindowRows,
    run: (db) => hydrateRetainedEventOutputRows(db, timelineWindowRows),
  },
  {
    name: `${RETAINED_EVENT_OUTPUTS}#canHydrateRetainedEventOutputRowsWithinDataByteLimit`,
    prepare: readTimelineWindowRows,
    run: (db) =>
      canHydrateRetainedEventOutputRowsWithinDataByteLimit(
        db,
        timelineWindowRows,
        THREAD_EVENT_RESPONSE_DATA_BYTE_LIMIT,
      ),
  },
  {
    name: `${RETAINED_EVENT_OUTPUTS}#hydrateRetainedEventOutputRowsWithinDataByteLimit`,
    prepare: readTimelineWindowRows,
    run: (db) =>
      hydrateRetainedEventOutputRowsWithinDataByteLimit(
        db,
        timelineWindowRows,
        TIMELINE_EVENT_DATA_BYTE_LIMIT,
      ),
  },
  {
    name: `${RETAINED_EVENT_OUTPUTS}#deleteExpiredRetainedEventOutputs`,
    run: (db) =>
      deleteExpiredRetainedEventOutputs(db, {
        expiredAtOrBefore: Date.now(),
        limit: RETAINED_OUTPUT_EXPIRY_BATCH_SIZE,
      }),
  },
  {
    name: `${SWEEPS}#pruneClosedSessions`,
    run: (db) =>
      pruneClosedSessions(db, {
        closedBefore: Date.now() - CLOSED_SESSION_ROW_RETENTION_MS,
        limit: DEFAULT_CLOSED_SESSION_PRUNE_BATCH_SIZE,
      }),
  },
  {
    name: `${SWEEPS}#migrateNextCompletedEventItemOutput`,
    prepare: (db, _fixture, seed) => {
      positionCommandMigrationBefore(db, seed.legacyCommandEventId);
    },
    run: (db) =>
      migrateNextCompletedEventItemOutput(db, {
        ...COMMAND_OUTPUT_TARGET,
        limit: DEFAULT_COMPLETED_EVENT_OUTPUT_MIGRATION_SCAN_LIMIT,
        migratedAt: Date.now(),
      }),
  },
  {
    name: `${SWEEPS}#migrateNextLegacyImageGenerationOutput`,
    prepare: (db, _fixture, seed) => {
      positionImageMigrationBefore(db, seed.legacyImageEventId);
    },
    run: (db) =>
      migrateNextLegacyImageGenerationOutput(db, {
        limit: DEFAULT_LEGACY_IMAGE_GENERATION_MIGRATION_SCAN_LIMIT,
        migratedAt: Date.now(),
      }),
  },
  {
    name: `${SWEEP_ITEM_FAILURES}#listSweepItemFailures`,
    run: (db) => listSweepItemFailures(db, ITEM_SWEEPS[0]),
  },
  {
    name: `${SWEEP_ITEM_FAILURES}#getSweepItemFailure`,
    run: (db, _fixture, seed) =>
      getSweepItemFailure(db, {
        sweep: ITEM_SWEEPS[0],
        itemKey: seed.staleSweepFailureKeys[0] ?? "",
      }),
  },
  {
    name: `${SWEEP_ITEM_FAILURES}#upsertSweepItemFailure`,
    run: (db, _fixture, seed) =>
      upsertSweepItemFailure(db, {
        sweep: ITEM_SWEEPS[0],
        itemKey: seed.staleSweepFailureKeys[0] ?? "",
        attempts: 13,
        firstFailedAt: Date.now() - 24 * 60 * 60_000,
        retryAt: Date.now() + 60 * 60_000,
        lastError: "ENOTEMPTY: directory not empty, rmdir '/workspace/.bb'",
      }),
  },
  {
    name: `${SWEEP_ITEM_FAILURES}#deleteSweepItemFailures`,
    run: (db, _fixture, seed) =>
      deleteSweepItemFailures(db, {
        sweep: ITEM_SWEEPS[0],
        itemKeys: seed.staleSweepFailureKeys,
      }),
  },
  {
    name: `${SWEEP_ITEM_FAILURES}#deleteSweepItemFailuresOfUnknownSweeps`,
    run: (db) => deleteSweepItemFailuresOfUnknownSweeps(db, KNOWN_SWEEPS),
  },
];

const INTERACTION_CASES: readonly Case[] = [
  {
    name: `${PENDING_INTERACTIONS}#createPendingInteraction`,
    run: (db, fixture) =>
      createPendingInteraction(db, {
        originKind: "provider",
        providerId: "query-costs",
        providerRequestId: "request-new",
        providerThreadId: fixture.providerThreadId,
        turnId: lastTurn(fixture).turnId,
        threadId: fixture.threadId,
        payload: JSON.stringify({
          kind: "commandApproval",
          command: "git push --force-with-lease",
          cwd: "/workspace/bb",
        }),
        expiresAt: null,
      }),
  },
  {
    name: `${PENDING_INTERACTIONS}#getPendingInteraction`,
    run: (db, _fixture, seed) =>
      getPendingInteraction(db, seed.pendingProviderInteractionId),
  },
  {
    name: `${PENDING_INTERACTIONS}#getPendingInteractionByProviderRequest`,
    run: (db, _fixture, seed) =>
      getPendingInteractionByProviderRequest(db, seed.pendingProviderRequest),
  },
  {
    name: `${PENDING_INTERACTIONS}#listActiveProviderPendingInteractionsForHost`,
    run: (db, fixture) =>
      listActiveProviderPendingInteractionsForHost(db, {
        hostId: fixture.hostId,
      }),
  },
  {
    name: `${PENDING_INTERACTIONS}#listActivePluginPendingInteractions`,
    run: (db) => listActivePluginPendingInteractions(db),
  },
  {
    name: `${PENDING_INTERACTIONS}#getActivePendingInteractionForThread`,
    run: (db, fixture) =>
      getActivePendingInteractionForThread(db, fixture.threadId),
  },
  {
    name: `${PENDING_INTERACTIONS}#hasTurnBoundActivePendingInteractionForThread`,
    run: (db, fixture) =>
      hasTurnBoundActivePendingInteractionForThread(db, fixture.threadId),
  },
  {
    name: `${PENDING_INTERACTIONS}#listPendingInteractionsByThread`,
    run: (db, fixture) =>
      listPendingInteractionsByThread(db, {
        threadId: fixture.threadId,
        statuses: ["pending", "resolving"],
      }),
  },
  {
    name: `${PENDING_INTERACTIONS}#setPendingInteractionResolving`,
    run: (db, _fixture, seed) =>
      setPendingInteractionResolving(db, {
        id: seed.pendingProviderInteractionId,
        resolution: JSON.stringify({ decision: "approve" }),
      }),
  },
  {
    name: `${PENDING_INTERACTIONS}#setPendingInteractionResolved`,
    run: (db, _fixture, seed) =>
      setPendingInteractionResolved(db, {
        id: seed.pendingProviderInteractionId,
        resolution: JSON.stringify({ decision: "approveForSession" }),
      }),
  },
  {
    name: `${PENDING_INTERACTIONS}#setPendingInteractionInterrupted`,
    run: (db, _fixture, seed) =>
      setPendingInteractionInterrupted(db, {
        id: seed.pendingProviderInteractionId,
        statusReason: "thread-stopped",
      }),
  },
  {
    name: `${PENDING_INTERACTIONS}#interruptPendingInteractionsForThreads`,
    prepare: (db, fixture) => {
      hostThreadIds = listHostThreadIds(db, { hostId: fixture.hostId });
    },
    run: (db) =>
      interruptPendingInteractionsForThreads(db, {
        providerId: "query-costs",
        statusReason: "Provider session restarted",
        threadIds: hostThreadIds,
      }),
  },
  {
    name: `${PENDING_INTERACTIONS}#interruptPendingInteractionsForThreadIds`,
    prepare: (db, fixture) => {
      hostThreadIds = listHostThreadIds(db, { hostId: fixture.hostId });
    },
    run: (db) =>
      interruptPendingInteractionsForThreadIds(db, {
        statusReason: "Host daemon disconnected",
        threadIds: hostThreadIds,
      }),
  },
  {
    name: `${PENDING_INTERACTIONS}#interruptPendingInteractionsForPlugin`,
    run: (db) =>
      interruptPendingInteractionsForPlugin(db, {
        pluginId: BUSIEST_PLUGIN_ID,
        statusReason: "Plugin was disabled",
      }),
  },
  {
    name: `${PROVIDER_MODEL_CATALOGS}#getStoredProviderModelCatalog`,
    run: (db, _fixture, seed) =>
      getStoredProviderModelCatalog(db, seed.catalogKey),
  },
  {
    name: `${PROVIDER_MODEL_CATALOGS}#replaceStoredProviderModelCatalog`,
    prepare: (db, _fixture, seed) => {
      storedCatalog = getStoredProviderModelCatalog(db, seed.catalogKey);
    },
    run: (db, _fixture, seed) => {
      if (storedCatalog === null) {
        throw new Error("Expected a stored model catalog");
      }
      const fetchedAt = seed.catalogFetchedAt + 60_000;
      return replaceStoredProviderModelCatalog(db, {
        row: { ...storedCatalog, fingerprint: "refreshed", fetchedAt },
        pruneWorkspaceRowsFetchedBefore:
          fetchedAt - WORKSPACE_CATALOG_RETENTION_MS,
      });
    },
  },
  {
    name: `${PROVIDER_MODEL_CATALOGS}#deleteStoredProviderModelCatalogsForHost`,
    run: (db, fixture) =>
      deleteStoredProviderModelCatalogsForHost(db, fixture.hostId),
  },
];

export const SETTINGS_MAINTENANCE_COST_GROUP = registerCostGroup({
  name: "settings-maintenance",
  seed: seedSettingsMaintenance,
  cases: [...SETTINGS_CASES, ...MAINTENANCE_CASES, ...INTERACTION_CASES],
});
