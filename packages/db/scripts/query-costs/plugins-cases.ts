import {
  createPluginArtifact,
  deletePluginArtifact,
  getPluginArtifact,
  getPluginArtifactByResolution,
  listInstalledPluginIdsOverlappingPath,
  listPendingGitPluginArtifacts,
  listPluginArtifacts,
  listPluginArtifactsAtOrUnderPath,
  listPluginArtifactsInGitCheckout,
  listPluginArtifactsUnderPath,
  listRecentPluginArtifacts,
  setPluginArtifactGitCheckoutRoot,
  setPluginArtifactValidation,
} from "../../src/data/plugin-artifacts.js";
import {
  deletePluginMarketplace,
  getPluginMarketplace,
  getPluginMarketplaceIcon,
  listPluginMarketplaceIcons,
  listPluginMarketplaces,
  recordPluginMarketplaceRefreshFailure,
  replacePluginMarketplaceIcons,
  upsertPluginMarketplace,
  type PluginMarketplaceIconRow,
  type PluginMarketplaceRow,
} from "../../src/data/plugin-marketplaces.js";
import {
  claimPluginScheduledRun,
  deletePluginSchedules,
  listDuePluginSchedules,
  listPluginSchedules,
  prunePluginSchedules,
  recordPluginScheduleResult,
  upsertPluginSchedule,
  type PluginScheduleRow,
} from "../../src/data/plugin-schedules.js";
import {
  createPluginStateSnapshot,
  deletePluginStateSnapshot,
  getPluginStateSnapshot,
  listDiscardablePluginStateSnapshots,
  listGarbageCollectablePluginArtifacts,
  listIncompletePluginRollbackSnapshots,
  listPluginStateSnapshots,
  replacePluginSnapshotState,
  setPluginStateSnapshotRollbackPending,
  setPluginStateSnapshotStatus,
} from "../../src/data/plugin-state-snapshots.js";
import {
  deleteAllPluginKvValues,
  deleteAllPluginSettings,
  deletePluginKvValue,
  getPluginKvValue,
  getPluginSettingsValues,
  listPluginKvKeys,
  listPluginKvRows,
  listPluginSettingRows,
  setPluginKvValue,
  setPluginSettingsValues,
  type PluginKvRow,
  type PluginSettingRow,
} from "../../src/data/plugin-storage.js";
import {
  deleteInstalledPlugin,
  getInstalledPlugin,
  getInstalledPluginRegistration,
  listInstalledPlugins,
  listInstalledPluginsFromMarketplace,
  listUnnormalizedPluginRegistrations,
  markInstalledPluginRemoved,
  normalizeInstalledPluginRegistration,
  restoreRemovedInstalledPlugin,
  setInstalledPluginDirectProvenance,
  setInstalledPluginEnabled,
  setInstalledPluginLastFailure,
  setInstalledPluginSourceClassification,
  setInstalledPluginUpdateState,
  upsertInstalledPlugin,
} from "../../src/data/plugins.js";
import { eq } from "drizzle-orm";
import { pluginArtifacts } from "../../src/schema.js";
import { registerCostGroup, type QueryCostCase } from "./case.js";
import {
  PLUGINS_CACHE_ROOT,
  PLUGINS_DATA_DIR,
  seedPluginsWorld,
  type PluginsSeed,
} from "./plugins-cases-seed.js";

const PLUGINS = "packages/db/src/data/plugins.ts";
const ARTIFACTS = "packages/db/src/data/plugin-artifacts.ts";
const MARKETPLACES = "packages/db/src/data/plugin-marketplaces.ts";
const SCHEDULES = "packages/db/src/data/plugin-schedules.ts";
const SNAPSHOTS = "packages/db/src/data/plugin-state-snapshots.ts";
const STORAGE = "packages/db/src/data/plugin-storage.ts";
const SEP = "/";
const ARTIFACT_RETENTION_MS = 7 * 86_400_000;

let snapshotState: {
  kv: PluginKvRow[];
  settings: PluginSettingRow[];
  schedules: PluginScheduleRow[];
} | null = null;
let marketplaceRow: PluginMarketplaceRow | null = null;
let marketplaceIcons: PluginMarketplaceIconRow[] = [];

function requireSnapshotState(): NonNullable<typeof snapshotState> {
  if (snapshotState === null) throw new Error("Expected snapshot state");
  return snapshotState;
}

function requireMarketplaceRow(): PluginMarketplaceRow {
  if (marketplaceRow === null) throw new Error("Expected a marketplace row");
  return marketplaceRow;
}

const CASES: readonly QueryCostCase<PluginsSeed>[] = [
  {
    name: `${PLUGINS}#listInstalledPlugins`,
    run: (db) => listInstalledPlugins(db),
  },
  {
    name: `${PLUGINS}#getInstalledPlugin`,
    run: (db, _fixture, seed) => getInstalledPlugin(db, seed.npmPluginId),
  },
  {
    name: `${PLUGINS}#getInstalledPluginRegistration`,
    run: (db, _fixture, seed) =>
      getInstalledPluginRegistration(db, seed.removedPluginId),
  },
  {
    name: `${PLUGINS}#listUnnormalizedPluginRegistrations`,
    run: (db) => listUnnormalizedPluginRegistrations(db),
  },
  {
    name: `${PLUGINS}#normalizeInstalledPluginRegistration`,
    run: (db, _fixture, seed) =>
      normalizeInstalledPluginRegistration(db, {
        id: seed.legacyPlugin.id,
        source: seed.legacyPlugin.rootDir,
        provenance: { kind: "direct" },
        sourceIntent: {
          kind: "path",
          canonicalPath: seed.legacyPlugin.rootDir,
        },
        exactResolution: { kind: "path" },
        updateState: {
          lastCheckAt: null,
          availableCompatibleVersion: null,
          newestIncompatibleVersion: null,
          statusDetail: null,
        },
        activeArtifactId: null,
        rootDir: seed.legacyPlugin.rootDir,
        version: "1.0.0",
        enabled: true,
      }),
  },
  {
    name: `${PLUGINS}#upsertInstalledPlugin`,
    run: (db, _fixture, seed) =>
      upsertInstalledPlugin(db, {
        id: seed.npmPluginId,
        source: `@bb-community/${seed.npmPluginId}`,
        provenance: {
          kind: "catalog",
          marketplace: seed.marketplaceName,
          entryId: seed.npmPluginId,
        },
        sourceIntent: {
          kind: "npm",
          packageName: `@bb-community/${seed.npmPluginId}`,
          registry: "https://registry.npmjs.org/",
          requestedSpec: "^1.0.0",
          specKind: "range",
        },
        exactResolution: {
          kind: "npm",
          version: seed.npmArtifact.version,
          integrity: seed.npmArtifact.integrity,
        },
        updateState: {
          lastCheckAt: Date.now(),
          availableCompatibleVersion: null,
          newestIncompatibleVersion: null,
          statusDetail: null,
        },
        activeArtifactId: seed.npmArtifact.id,
        rootDir: seed.npmArtifact.path,
        version: seed.npmArtifact.version,
        enabled: true,
        enabledFollowsDefault: false,
      }),
  },
  {
    name: `${PLUGINS}#listInstalledPluginsFromMarketplace`,
    run: (db, _fixture, seed) =>
      listInstalledPluginsFromMarketplace(db, seed.marketplaceName),
  },
  {
    name: `${PLUGINS}#setInstalledPluginDirectProvenance`,
    run: (db, _fixture, seed) =>
      setInstalledPluginDirectProvenance(db, seed.catalogPluginId),
  },
  {
    name: `${PLUGINS}#setInstalledPluginEnabled`,
    run: (db, _fixture, seed) =>
      setInstalledPluginEnabled(db, seed.gitPluginId, false),
  },
  {
    name: `${PLUGINS}#setInstalledPluginUpdateState`,
    run: (db, _fixture, seed) =>
      setInstalledPluginUpdateState(db, seed.npmPluginId, {
        lastCheckAt: Date.now(),
        availableCompatibleVersion: "2.0.0",
        newestIncompatibleVersion: "3.0.0",
        statusDetail: "Requires a newer bb",
      }),
  },
  {
    name: `${PLUGINS}#setInstalledPluginLastFailure`,
    run: (db, _fixture, seed) =>
      setInstalledPluginLastFailure(db, seed.gitPluginId, {
        version: "2.4.1",
        label: "activation",
        detail: "Plugin failed to activate",
        at: Date.now(),
      }),
  },
  {
    name: `${PLUGINS}#setInstalledPluginSourceClassification`,
    run: (db, _fixture, seed) =>
      setInstalledPluginSourceClassification(db, seed.npmPluginId, {
        kind: "npm",
        specKind: "range",
      }),
  },
  {
    name: `${PLUGINS}#deleteInstalledPlugin`,
    run: (db, _fixture, seed) => deleteInstalledPlugin(db, seed.npmPluginId),
  },
  {
    name: `${PLUGINS}#restoreRemovedInstalledPlugin`,
    run: (db, _fixture, seed) =>
      restoreRemovedInstalledPlugin(db, seed.removedPluginId),
  },
  {
    name: `${PLUGINS}#markInstalledPluginRemoved`,
    run: (db, _fixture, seed) =>
      markInstalledPluginRemoved(db, seed.npmPluginId),
  },
  {
    name: `${ARTIFACTS}#createPluginArtifact`,
    run: (db, _fixture, seed) =>
      createPluginArtifact(db, {
        id: "artifact-query-costs-new",
        pluginId: seed.npmPluginId,
        sourceKind: "npm",
        path: `${PLUGINS_CACHE_ROOT}/npm/@bb-community/${seed.npmPluginId}/9.9.9/node_modules/@bb-community/${seed.npmPluginId}`,
        npmResolvedVersion: "9.9.9",
        gitResolvedCommit: null,
        gitCheckoutRoot: null,
        integrity: "sha512-query-costs",
        contentHash: null,
        validationResult: "pending",
        validatedAt: null,
      }),
  },
  {
    name: `${ARTIFACTS}#getPluginArtifact`,
    run: (db, _fixture, seed) => getPluginArtifact(db, seed.npmArtifact.id),
  },
  {
    name: `${ARTIFACTS}#listPluginArtifacts`,
    run: (db, _fixture, seed) => listPluginArtifacts(db, seed.npmPluginId),
  },
  {
    name: `${ARTIFACTS}#listPendingGitPluginArtifacts`,
    run: (db) => listPendingGitPluginArtifacts(db),
  },
  {
    name: `${ARTIFACTS}#listPluginArtifactsUnderPath`,
    run: (db, _fixture, seed) =>
      listPluginArtifactsUnderPath(db, seed.busiestCheckoutRoot, SEP),
  },
  {
    name: `${ARTIFACTS}#listPluginArtifactsAtOrUnderPath`,
    run: (db, _fixture, seed) =>
      listPluginArtifactsAtOrUnderPath(db, seed.busiestCheckoutRoot, SEP),
  },
  {
    name: `${ARTIFACTS}#listInstalledPluginIdsOverlappingPath`,
    run: (db, _fixture, seed) =>
      listInstalledPluginIdsOverlappingPath(
        db,
        seed.npmArtifact.storageRoot,
        SEP,
      ),
  },
  {
    name: `${ARTIFACTS}#listPluginArtifactsInGitCheckout`,
    run: (db, _fixture, seed) =>
      listPluginArtifactsInGitCheckout(db, seed.busiestCheckoutRoot),
  },
  {
    name: `${ARTIFACTS}#listRecentPluginArtifacts`,
    run: (db, _fixture, seed) =>
      listRecentPluginArtifacts(db, seed.npmPluginId, 10),
  },
  {
    name: `${ARTIFACTS}#getPluginArtifactByResolution`,
    run: (db, _fixture, seed) =>
      getPluginArtifactByResolution(db, {
        sourceKind: "npm",
        pluginId: seed.npmArtifact.pluginId,
        path: seed.npmArtifact.path,
        version: seed.npmArtifact.version,
        integrity: seed.npmArtifact.integrity,
      }),
  },
  {
    name: `${ARTIFACTS}#setPluginArtifactValidation`,
    run: (db, _fixture, seed) =>
      setPluginArtifactValidation(db, seed.pendingGitArtifactId, {
        contentHash: "f".repeat(64),
        validationResult: "valid",
        validatedAt: Date.now(),
      }),
  },
  {
    name: `${ARTIFACTS}#setPluginArtifactGitCheckoutRoot`,
    prepare: (db, _fixture, seed) => {
      db.update(pluginArtifacts)
        .set({ gitCheckoutRoot: null })
        .where(eq(pluginArtifacts.id, seed.gitArtifact.id))
        .run();
    },
    run: (db, _fixture, seed) =>
      setPluginArtifactGitCheckoutRoot(
        db,
        seed.gitArtifact.id,
        seed.gitArtifact.checkoutRoot,
      ),
  },
  {
    name: `${ARTIFACTS}#deletePluginArtifact`,
    run: (db, _fixture, seed) => deletePluginArtifact(db, seed.npmArtifact.id),
  },
  {
    name: `${SNAPSHOTS}#createPluginStateSnapshot`,
    run: (db, _fixture, seed) => {
      const now = Date.now();
      const snapshotPath = `${PLUGINS_DATA_DIR}/plugins/snapshots/query-costs-new`;
      return createPluginStateSnapshot(db, {
        id: "snapshot-query-costs-new",
        pluginId: seed.npmPluginId,
        fromArtifactId: seed.npmArtifact.id,
        toArtifactId: seed.npmArtifact.id,
        snapshotPath,
        databasePath: `${snapshotPath}/storage.sqlite`,
        statePath: `${snapshotPath}/state.json`,
        secretsPath: null,
        registrationPath: `${snapshotPath}/registration.json`,
        status: "pending",
        rollbackCandidateVersion: null,
        rollbackCandidateLabel: null,
        rollbackSourceFingerprint: null,
        rollbackBbVersion: null,
        rollbackSdkVersion: null,
        rollbackDetail: null,
        createdAt: now,
        retainedUntil: now + 30 * 86_400_000,
        updatedAt: now,
      });
    },
  },
  {
    name: `${SNAPSHOTS}#getPluginStateSnapshot`,
    run: (db, _fixture, seed) =>
      getPluginStateSnapshot(db, seed.readySnapshotId),
  },
  {
    name: `${SNAPSHOTS}#listPluginStateSnapshots`,
    run: (db, _fixture, seed) => listPluginStateSnapshots(db, seed.npmPluginId),
  },
  {
    name: `${SNAPSHOTS}#listIncompletePluginRollbackSnapshots`,
    run: (db) => listIncompletePluginRollbackSnapshots(db),
  },
  {
    name: `${SNAPSHOTS}#setPluginStateSnapshotRollbackPending`,
    run: (db, _fixture, seed) =>
      setPluginStateSnapshotRollbackPending(db, seed.readySnapshotId, {
        candidateVersion: "1.2.3",
        candidateLabel: "previous version",
        sourceFingerprint: "a".repeat(64),
        bbVersion: "0.80.0",
        sdkVersion: "0.40.0",
        detail: "Update failed to activate",
        updatedAt: Date.now(),
      }),
  },
  {
    name: `${SNAPSHOTS}#setPluginStateSnapshotStatus`,
    run: (db, _fixture, seed) =>
      setPluginStateSnapshotStatus(
        db,
        seed.readySnapshotId,
        "restored",
        Date.now(),
      ),
  },
  {
    name: `${SNAPSHOTS}#listDiscardablePluginStateSnapshots`,
    run: (db) => {
      const now = Date.now();
      return listDiscardablePluginStateSnapshots(db, {
        createdBefore: now,
        now,
      });
    },
  },
  {
    name: `${SNAPSHOTS}#deletePluginStateSnapshot`,
    run: (db, _fixture, seed) =>
      deletePluginStateSnapshot(db, seed.readySnapshotId),
  },
  {
    name: `${SNAPSHOTS}#replacePluginSnapshotState`,
    prepare: (db, _fixture, seed) => {
      snapshotState = {
        kv: listPluginKvRows(db, seed.biggestKvPluginId),
        settings: listPluginSettingRows(db, seed.biggestKvPluginId),
        schedules: listPluginSchedules(db, seed.biggestKvPluginId),
      };
    },
    run: (db, _fixture, seed) =>
      replacePluginSnapshotState(
        db,
        seed.biggestKvPluginId,
        requireSnapshotState(),
      ),
  },
  {
    name: `${SNAPSHOTS}#listGarbageCollectablePluginArtifacts`,
    run: (db) => {
      const now = Date.now();
      return listGarbageCollectablePluginArtifacts(db, {
        retention: { now, cutoff: now - ARTIFACT_RETENTION_MS },
        pluginId: null,
      });
    },
  },
  {
    name: `${STORAGE}#getPluginKvValue`,
    run: (db, _fixture, seed) =>
      getPluginKvValue(db, seed.kvPluginId, seed.kvKey),
  },
  {
    name: `${STORAGE}#setPluginKvValue`,
    run: (db, _fixture, seed) =>
      setPluginKvValue(
        db,
        seed.kvPluginId,
        seed.kvKey,
        JSON.stringify({ accountId: "acct-2", at: Date.now() }),
      ),
  },
  {
    name: `${STORAGE}#deleteAllPluginKvValues`,
    run: (db, _fixture, seed) =>
      deleteAllPluginKvValues(db, seed.biggestKvPluginId),
  },
  {
    name: `${STORAGE}#deletePluginKvValue`,
    run: (db, _fixture, seed) =>
      deletePluginKvValue(db, seed.kvPluginId, seed.kvKey),
  },
  {
    name: `${STORAGE}#listPluginKvKeys`,
    run: (db, _fixture, seed) =>
      listPluginKvKeys(db, seed.kvPluginId, seed.kvPrefix),
  },
  {
    name: `${STORAGE}#getPluginSettingsValues`,
    run: (db, _fixture, seed) =>
      getPluginSettingsValues(db, seed.settingsPluginId),
  },
  {
    name: `${STORAGE}#setPluginSettingsValues`,
    run: (db, _fixture, seed) =>
      setPluginSettingsValues(db, seed.settingsPluginId, {
        setting0: JSON.stringify("disabled"),
        setting1: null,
        setting9: JSON.stringify("new"),
      }),
  },
  {
    name: `${STORAGE}#deleteAllPluginSettings`,
    run: (db, _fixture, seed) =>
      deleteAllPluginSettings(db, seed.settingsPluginId),
  },
  {
    name: `${STORAGE}#listPluginKvRows`,
    run: (db, _fixture, seed) => listPluginKvRows(db, seed.biggestKvPluginId),
  },
  {
    name: `${STORAGE}#listPluginSettingRows`,
    run: (db, _fixture, seed) =>
      listPluginSettingRows(db, seed.settingsPluginId),
  },
  {
    name: `${MARKETPLACES}#getPluginMarketplace`,
    run: (db, _fixture, seed) => getPluginMarketplace(db, seed.marketplaceName),
  },
  {
    name: `${MARKETPLACES}#listPluginMarketplaces`,
    run: (db) => listPluginMarketplaces(db),
  },
  {
    name: `${MARKETPLACES}#deletePluginMarketplace`,
    run: (db, _fixture, seed) =>
      deletePluginMarketplace(db, seed.marketplaceName),
  },
  {
    name: `${MARKETPLACES}#upsertPluginMarketplace`,
    prepare: (db, _fixture, seed) => {
      marketplaceRow = getPluginMarketplace(db, seed.marketplaceName) ?? null;
    },
    run: (db) => {
      const {
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...row
      } = requireMarketplaceRow();
      return upsertPluginMarketplace(db, {
        ...row,
        etag: '"refreshed"',
        lastSuccessfulRefreshAt: Date.now(),
        lastAttemptedRefreshAt: Date.now(),
      });
    },
  },
  {
    name: `${MARKETPLACES}#recordPluginMarketplaceRefreshFailure`,
    run: (db, _fixture, seed) =>
      recordPluginMarketplaceRefreshFailure(
        db,
        seed.marketplaceName,
        Date.now(),
        "fetch failed: getaddrinfo ENOTFOUND getbb.app",
      ),
  },
  {
    name: `${MARKETPLACES}#listPluginMarketplaceIcons`,
    run: (db, _fixture, seed) =>
      listPluginMarketplaceIcons(db, seed.marketplaceName),
  },
  {
    name: `${MARKETPLACES}#getPluginMarketplaceIcon`,
    run: (db, _fixture, seed) =>
      getPluginMarketplaceIcon(db, seed.marketplaceName, seed.iconEntryId),
  },
  {
    name: `${MARKETPLACES}#replacePluginMarketplaceIcons`,
    prepare: (db, _fixture, seed) => {
      marketplaceIcons = listPluginMarketplaceIcons(db, seed.marketplaceName);
    },
    run: (db, _fixture, seed) =>
      db.transaction((tx) =>
        replacePluginMarketplaceIcons(
          tx,
          seed.marketplaceName,
          marketplaceIcons.map(({ updatedAt: _updatedAt, ...icon }) => icon),
        ),
      ),
  },
  {
    name: `${SCHEDULES}#upsertPluginSchedule`,
    run: (db, _fixture, seed) =>
      upsertPluginSchedule(db, {
        pluginId: seed.schedulePluginId,
        name: seed.dueSchedule.name,
        cron: "*/10 * * * *",
        nextRunAt: Date.now() + 600_000,
      }),
  },
  {
    name: `${SCHEDULES}#prunePluginSchedules`,
    run: (db, _fixture, seed) =>
      prunePluginSchedules(
        db,
        seed.schedulePluginId,
        seed.scheduleNames.slice(0, -1),
      ),
  },
  {
    name: `${SCHEDULES}#deletePluginSchedules`,
    run: (db, _fixture, seed) =>
      deletePluginSchedules(db, seed.schedulePluginId),
  },
  {
    name: `${SCHEDULES}#listPluginSchedules`,
    run: (db) => listPluginSchedules(db),
  },
  {
    name: `${SCHEDULES}#listDuePluginSchedules`,
    run: (db, _fixture, seed) =>
      listDuePluginSchedules(db, {
        excludedKeys: new Set(seed.inFlightScheduleKeys),
        limit: 100,
        now: Date.now(),
        pluginIds: seed.loadedPluginIds,
      }),
  },
  {
    name: `${SCHEDULES}#claimPluginScheduledRun`,
    run: (db, _fixture, seed) =>
      claimPluginScheduledRun(db, {
        pluginId: seed.dueSchedule.pluginId,
        name: seed.dueSchedule.name,
        expectedNextRunAt: seed.dueSchedule.nextRunAt,
        newNextRunAt: Date.now() + 300_000,
        now: Date.now(),
      }),
  },
  {
    name: `${SCHEDULES}#recordPluginScheduleResult`,
    run: (db, _fixture, seed) =>
      recordPluginScheduleResult(db, {
        pluginId: seed.dueSchedule.pluginId,
        name: seed.dueSchedule.name,
        status: "error",
        error: "Request timed out",
        now: Date.now(),
      }),
  },
];

export const PLUGINS_COST_GROUP = registerCostGroup({
  name: "plugins",
  seed: seedPluginsWorld,
  cases: CASES,
});
