import {
  defaultAppSettings,
  threadScope,
  turnScope,
  type AppKeybindingOverrides,
} from "@bb/domain";
import { and, eq, sql } from "drizzle-orm";
import type { DbConnection } from "../../src/connection.js";
import {
  setAiServiceSelection,
  setAppKeybindingOverrides,
  setAppSettings,
  setAutoAppUpdate,
  setDisabledPluginProviderCatalog,
  setDisabledProviderIds,
  setPluginRecommendationId,
  setPluginSafeMode,
  setSkippedAppUpdate,
} from "../../src/data/app-settings.js";
import { setStoredAppearance } from "../../src/data/app-theme.js";
import {
  appendStoredThreadEventsInTransaction,
  type AppendStoredThreadEventArgs,
} from "../../src/data/events.js";
import { setExperiments } from "../../src/data/experiments.js";
import { upsertHost } from "../../src/data/hosts.js";
import {
  createPendingInteraction,
  setPendingInteractionInterrupted,
  setPendingInteractionResolved,
  setPendingInteractionResolving,
  type CreatePendingInteractionInput,
} from "../../src/data/pending-interactions.js";
import { replaceStoredProviderModelCatalog } from "../../src/data/provider-model-catalogs.js";
import { insertPreparedRetainedEventOutput } from "../../src/data/retained-event-outputs.js";
import { openSession } from "../../src/data/sessions.js";
import { upsertSweepItemFailure } from "../../src/data/sweep-item-failures.js";
import { createThread } from "../../src/data/threads.js";
import {
  overwriteStoredUiPreference,
  replaceStoredUiPreference,
} from "../../src/data/ui-preferences.js";
import { noopNotifier } from "../../src/notifier.js";
import {
  events,
  hostDaemonSessions,
  pendingInteractions,
  uiPreferenceDefaults,
} from "../../src/schema.js";
import type { HistoryFixture } from "../../src/history-fixture.js";
import { scaled } from "./case.js";

const DAY_MS = 24 * 60 * 60_000;
const PROVIDER_ID = "query-costs";
const RATE_LIMIT_TURNS = 5_000;
const RATE_LIMIT_TURNS_PER_BATCH = 500;
const PENDING_INTERACTIONS = 1_000;
const ACTIVE_PLUGIN_INTERACTIONS = 20;
const RETAINED_OUTPUTS = 2_000;
const LIVE_RETAINED_OUTPUTS = 400;
const LIVE_RETAINED_OUTPUT_STRIDE = 4;
const CLOSED_SESSIONS = 3_000;
const WORKSPACE_CATALOG_SCOPES = 7;
const LEGACY_TURN_REQUESTS = 10_000;
const LEGACY_COMMANDS = 20_000;
const LEGACY_OPERATIONS = 2_000;
const LEGACY_IMAGE_TURN_INTERVAL = 100;
const LEGACY_COMMAND_OUTPUTS = 200;
const LEGACY_HISTORY_FRACTION = 0.9;

export const COPY_BATCH_ROWS = 10;
export const PLUGIN_IDS = [
  "github-pr-status",
  "linear",
  "approvals",
  "forms",
  "slack",
] as const;
export const BUSIEST_PLUGIN_ID = PLUGIN_IDS[0];
export const PROVIDER_IDS = [
  "codex",
  "claude-code",
  "pi",
  "opencode",
  "acp-gemini",
] as const;
export const ITEM_SWEEPS = [
  "archived-thread-teardown",
  "deleted-thread-finalization",
  "environment-provisioning-orphan-cleanup",
  "thread-provisioning",
  "project-deletion",
] as const;
const SWEEP_FAILURE_SHARES = [300, 100, 50, 20, 20] as const;
const RETIRED_SWEEP_FAILURES = 10;

export const KNOWN_SWEEPS = [
  "project-deletion",
  "environment-provisioning-orphan-cleanup",
  "thread-provisioning",
  "archived-thread-teardown",
  "deleted-thread-finalization",
  "completed-event-output-migration",
  "thread-event-pruning",
  "environment-provider-lifecycle",
  "environment-preparation-owner-release",
  "machine-removal-request",
  "machine-provider-lifecycle",
  "machine-auth-prune",
  "retained-event-output-expiry",
  "closed-session-prune",
  "exited-terminal-session-prune",
  "thread-purge",
  "turn-start-deadline",
  "queued-message-claim-release",
  "queued-message-auto-send",
  "due-scheduled-queue-dispatch",
  "failed-queue-message-retry",
  "orphaned-queue-wait-clear",
  "plugin-schedule",
  "database-maintenance",
  "plugin-database-maintenance",
  "project-attachment-backfill",
  "project-attachment-orphan-prune",
  "thread-storage-orphan-cleanup",
] as const;

export const UI_PREFERENCE_KEYS = [
  "sidebar.organizationMode",
  "sidebar.threadGrouping.environment",
  "sidebar.chronologicalSort",
  "sidebar.sortDirection",
  "sidebar.sectionOrder",
  "sidebar.manualSectionOrder",
  "sidebar.machineSectionOrder",
  "sidebar.hiddenGroups",
  "sidebar.footerOrder",
  "sidebar.hiddenFooterItems",
  "sidebar.pluginPanelOrder",
  "sidebar.visiblePluginPanels",
  "sidebar.navigationProvider",
  "sidebar.threadListProvider",
  "composer.provider",
  "threadContextCard.pinned",
  "infoPanel.collapsedSections",
] as const;

export interface ProviderRequestRef {
  providerId: string;
  providerRequestId: string;
  providerThreadId: string;
}

export interface CatalogKey {
  hostId: string;
  providerId: string;
  scopeKey: string;
}

export interface SettingsMaintenanceSeed {
  remoteHostId: string;
  rateLimitThreadId: string;
  rateLimitLatestSequence: number;
  legacyImageEventId: string;
  legacyCommandEventId: string;
  pendingProviderInteractionId: string;
  pendingProviderRequest: ProviderRequestRef;
  liveRetainedEventIds: string[];
  copyTargetEventIds: string[];
  unretainedEventId: string;
  staleSweepFailureKeys: string[];
  catalogKey: CatalogKey;
  catalogFetchedAt: number;
}

const LEGACY_IMAGE_RESULT =
  "iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6".repeat(1_000);

export const RETAINED_OUTPUT_VALUE = Array.from(
  { length: 700 },
  (_, line) =>
    `${String(line).padStart(4, "0")} ✓ test/query-plan-audit.test.ts > audits every query (6 tests) 12ms\n`,
).join("");

function pick<T>(values: readonly T[], index: number): T {
  const value = values[index % values.length];
  if (value === undefined) throw new Error("Expected a value to pick");
  return value;
}

function appendTransaction(
  db: DbConnection,
  rows: AppendStoredThreadEventArgs[],
): number[] {
  return db.transaction(
    (tx) => appendStoredThreadEventsInTransaction(tx, rows),
    { behavior: "immediate" },
  );
}

function rateLimitEvent(
  threadId: string,
  providerThreadId: string,
  index: number,
): AppendStoredThreadEventArgs {
  return {
    threadId,
    providerThreadId,
    scope: threadScope(),
    type: "provider/rateLimits/updated",
    data: {
      providerThreadId,
      rateLimits: {
        providerId: PROVIDER_ID,
        status: index % 40 === 0 ? "warning" : "allowed",
        kind: "subscription-window",
        windows: [
          {
            providerKey: "primary",
            label: "5h",
            status: "allowed",
            resetsAtMs: 1_800_000_000_000 + index * 60_000,
          },
          {
            providerKey: "secondary",
            label: "Weekly",
            status: index % 40 === 0 ? "warning" : "allowed",
            resetsAtMs: 1_800_000_000_000 + index * 600_000,
          },
        ],
        reachedReason: null,
        overageStatus: null,
        overageReason: null,
      },
    },
  };
}

function legacyImageGenerationEvent(
  threadId: string,
  providerThreadId: string,
  index: number,
): AppendStoredThreadEventArgs {
  return {
    threadId,
    providerThreadId,
    scope: turnScope(`rl-t${index}`),
    type: "provider/unhandled",
    data: {
      providerThreadId,
      providerId: "codex",
      rawType: "item/completed",
      rawEvent: {
        jsonrpc: "2.0",
        method: "item/completed",
        params: {
          threadId: providerThreadId,
          turnId: `rl-t${index}`,
          item: {
            type: "imageGeneration",
            id: `ig_${index}`,
            status: "completed",
            revisedPrompt: "A clean architecture diagram of the query planner",
            savedPath: `/workspace/bb/.bb/images/ig_${index}.png`,
            transparentBackground: false,
            failure: null,
            result: `${index}:${LEGACY_IMAGE_RESULT}`,
          },
        },
      },
    },
  };
}

function seedRateLimitThread(
  db: DbConnection,
  fixture: HistoryFixture,
  scale: number,
): { threadId: string; latestSequence: number; legacyImageEventId: string } {
  const thread = createThread(db, noopNotifier, {
    projectId: fixture.projectId,
    environmentId: fixture.environmentId,
    providerId: PROVIDER_ID,
    status: "idle",
  });
  const providerThreadId = "provider-rate-limited";
  let latestSequence = 0;
  appendTransaction(db, [
    {
      threadId: thread.id,
      providerThreadId,
      scope: threadScope(),
      type: "thread/identity",
      data: { providerThreadId },
    },
  ]);
  const turns = scaled(RATE_LIMIT_TURNS, scale);
  for (let start = 1; start <= turns; start += RATE_LIMIT_TURNS_PER_BATCH) {
    const rows: AppendStoredThreadEventArgs[] = [];
    const end = Math.min(turns, start + RATE_LIMIT_TURNS_PER_BATCH - 1);
    for (let index = start; index <= end; index += 1) {
      const scope = turnScope(`rl-t${index}`);
      rows.push(
        {
          threadId: thread.id,
          providerThreadId,
          scope,
          type: "turn/started",
          data: { providerThreadId },
        },
        rateLimitEvent(thread.id, providerThreadId, index),
        {
          threadId: thread.id,
          providerThreadId,
          scope,
          type: "turn/completed",
          data: {
            providerThreadId,
            status: "completed",
            providerCheckpointId: `rl-t${index}-checkpoint`,
          },
        },
      );
      if (index % LEGACY_IMAGE_TURN_INTERVAL === 0) {
        rows.push(
          legacyImageGenerationEvent(thread.id, providerThreadId, index),
        );
      }
    }
    latestSequence = appendTransaction(db, rows).at(-1) ?? latestSequence;
  }
  const imageEventIds = db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.threadId, thread.id),
        eq(events.type, "provider/unhandled"),
      ),
    )
    .orderBy(events.sequence)
    .all()
    .map((row) => row.id);
  return {
    threadId: thread.id,
    latestSequence,
    legacyImageEventId: pick(
      imageEventIds,
      Math.floor(imageEventIds.length / 2),
    ),
  };
}

interface InteractionThread {
  threadId: string;
  providerThreadId: string;
  turnPrefix: string;
  turnCount: number;
}

function interactionThreads(fixture: HistoryFixture): InteractionThread[] {
  return [
    {
      threadId: fixture.threadId,
      providerThreadId: fixture.providerThreadId,
      turnPrefix: "h",
      turnCount: fixture.turns.length,
    },
    ...fixture.neighborThreadIds.map((threadId, index) => ({
      threadId,
      providerThreadId: `provider-neighbor-${index}`,
      turnPrefix: `n${index}`,
      turnCount: 200,
    })),
  ];
}

function interactionThreadAt(
  threads: readonly InteractionThread[],
  index: number,
): InteractionThread {
  const neighbors = threads.length - 1;
  return pick(
    threads,
    neighbors === 0 || index % 10 < 6 ? 0 : 1 + (index % neighbors),
  );
}

function approvalPayload(index: number): string {
  return JSON.stringify({
    kind: "commandApproval",
    command: `pnpm exec turbo run test --filter=@bb/db -- test/${index}.test.ts`,
    cwd: "/workspace/bb",
    reason: "The command writes outside the workspace sandbox.",
    availableDecisions: ["approve", "approveForSession", "deny"],
  });
}

function pluginPayload(index: number): string {
  return JSON.stringify({
    title: "Choose a reviewer",
    fields: [
      { id: "reviewer", kind: "select", options: ["alice", "bob", "carol"] },
      { id: "note", kind: "text", value: `Request ${index}` },
    ],
  });
}

function interactionInput(
  thread: InteractionThread,
  index: number,
  origin: "provider" | "plugin",
): CreatePendingInteractionInput {
  const turnId = `${thread.turnPrefix}-t${1 + (index % thread.turnCount)}`;
  if (origin === "plugin") {
    return {
      originKind: "plugin",
      pluginId: index % 2 === 0 ? BUSIEST_PLUGIN_ID : pick(PLUGIN_IDS, index),
      rendererId: "form",
      turnId: index % 3 === 0 ? null : turnId,
      threadId: thread.threadId,
      payload: pluginPayload(index),
      expiresAt: null,
    };
  }
  return {
    originKind: "provider",
    providerId: PROVIDER_ID,
    providerRequestId: `request-${index}`,
    providerThreadId: thread.providerThreadId,
    turnId,
    threadId: thread.threadId,
    payload: approvalPayload(index),
    expiresAt: null,
  };
}

function seedPendingInteractions(
  db: DbConnection,
  fixture: HistoryFixture,
  scale: number,
): { pendingProviderInteractionId: string; request: ProviderRequestRef } {
  const threads = interactionThreads(fixture);
  const settled = scaled(PENDING_INTERACTIONS, scale);
  const activePlugin = scaled(ACTIVE_PLUGIN_INTERACTIONS, scale);
  let pendingProviderInteractionId = "";
  let request: ProviderRequestRef | null = null;
  const seededAfterRowid =
    db.get<{ rowid: number | null }>(
      sql`SELECT max(rowid) AS rowid FROM pending_interactions`,
    )?.rowid ?? 0;
  db.transaction((tx) => {
    for (let index = 0; index < settled; index += 1) {
      const origin = index % 5 === 0 ? "plugin" : "provider";
      const row = createPendingInteraction(
        tx,
        interactionInput(interactionThreadAt(threads, index), index, origin),
      );
      if (index % 10 === 9) {
        setPendingInteractionInterrupted(tx, {
          id: row.id,
          statusReason: "Turn was interrupted",
        });
      } else {
        setPendingInteractionResolved(tx, {
          id: row.id,
          resolution: JSON.stringify({ decision: "approve" }),
        });
      }
    }
    for (let index = 0; index < activePlugin; index += 1) {
      const thread = pick(threads, index);
      const row = createPendingInteraction(
        tx,
        interactionInput(thread, settled + index, "plugin"),
      );
      if (index % 4 === 3) {
        setPendingInteractionResolving(tx, {
          id: row.id,
          resolution: JSON.stringify({ reviewer: "alice" }),
        });
      }
    }
    threads.forEach((thread, offset) => {
      const index = settled + activePlugin + offset;
      const input = interactionInput(thread, index, "provider");
      const row = createPendingInteraction(tx, input);
      if (
        thread.threadId === fixture.threadId &&
        input.originKind !== "plugin"
      ) {
        pendingProviderInteractionId = row.id;
        request = {
          providerId: input.providerId,
          providerRequestId: input.providerRequestId,
          providerThreadId: input.providerThreadId,
        };
      }
    });
    const now = Date.now();
    const lastRowid =
      seededAfterRowid + settled + activePlugin + threads.length;
    tx.update(pendingInteractions)
      .set({ createdAt: sql`${now} - (${lastRowid} - rowid) * 600000` })
      .where(sql`rowid > ${seededAfterRowid}`)
      .run();
  });
  if (request === null) throw new Error("Expected a pending provider request");
  return { pendingProviderInteractionId, request };
}

function seedLegacyCommandOutputs(
  db: DbConnection,
  newestFirstCompletions: readonly string[],
  retained: ReadonlySet<string>,
  scale: number,
): string {
  const candidates = newestFirstCompletions
    .slice(
      Math.floor(newestFirstCompletions.length * (1 - LEGACY_HISTORY_FRACTION)),
    )
    .filter((eventId) => !retained.has(eventId));
  const count = scaled(LEGACY_COMMAND_OUTPUTS, scale);
  const stride = Math.max(1, Math.floor(candidates.length / count));
  const legacyIds = candidates
    .filter((_, index) => index % stride === Math.floor(stride / 2))
    .slice(0, count);
  const update = db.$client.prepare(
    "UPDATE events SET data = json_set(data, '$.item.aggregatedOutput', ?) WHERE id = ?",
  );
  db.transaction(() => {
    for (const eventId of legacyIds) {
      update.run(`${eventId}\n${RETAINED_OUTPUT_VALUE}`, eventId);
    }
  });
  return pick(legacyIds, Math.floor(legacyIds.length / 2));
}

function seedRetainedOutputs(
  db: DbConnection,
  fixture: HistoryFixture,
  scale: number,
): {
  liveRetainedEventIds: string[];
  copyTargetEventIds: string[];
  unretainedEventId: string;
  legacyCommandEventId: string;
} {
  const commandCompletions = db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.threadId, fixture.threadId),
        eq(events.type, "item/completed"),
        eq(events.itemKind, "commandExecution"),
      ),
    )
    .orderBy(sql`${events.sequence} DESC`)
    .all()
    .map((row) => row.id);
  const live = scaled(LIVE_RETAINED_OUTPUTS, scale);
  const expired = scaled(RETAINED_OUTPUTS, scale) - live;
  const liveIds = commandCompletions
    .slice(0, live * LIVE_RETAINED_OUTPUT_STRIDE)
    .filter((_, index) => index % LIVE_RETAINED_OUTPUT_STRIDE === 0);
  const older = commandCompletions.slice(live * LIVE_RETAINED_OUTPUT_STRIDE);
  const stride = Math.max(1, Math.floor(older.length / expired));
  const expiredIds = older
    .filter((_, index) => index % stride === 0)
    .slice(0, expired);
  const now = Date.now();
  db.transaction((tx) => {
    liveIds.forEach((eventId, index) => {
      insertPreparedRetainedEventOutput(tx, {
        eventId,
        output: {
          expiresAt: now + 7 * DAY_MS - index * 60 * 60_000,
          outputPath: "aggregatedOutput",
          value: `${eventId}\n${RETAINED_OUTPUT_VALUE}`,
        },
      });
    });
    expiredIds.forEach((eventId, index) => {
      insertPreparedRetainedEventOutput(tx, {
        eventId,
        output: {
          expiresAt: now - DAY_MS - (expiredIds.length - index) * 60 * 60_000,
          outputPath: "aggregatedOutput",
          value: `${eventId}\n${RETAINED_OUTPUT_VALUE}`,
        },
      });
    });
  });
  const legacyCommandEventId = seedLegacyCommandOutputs(
    db,
    commandCompletions,
    new Set([...liveIds, ...expiredIds]),
    scale,
  );
  const neighborThreadId = fixture.neighborThreadIds[0];
  if (neighborThreadId === undefined) throw new Error("Expected a neighbor");
  const copyTargetEventIds = db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.threadId, neighborThreadId),
        eq(events.type, "item/completed"),
        eq(events.itemKind, "commandExecution"),
      ),
    )
    .orderBy(sql`${events.sequence} DESC`)
    .limit(COPY_BATCH_ROWS)
    .all()
    .map((row) => row.id);
  const unretainedEventId = commandCompletions[1];
  if (unretainedEventId === undefined) {
    throw new Error("Expected a command completion without retained output");
  }
  return {
    liveRetainedEventIds: liveIds,
    copyTargetEventIds,
    unretainedEventId,
    legacyCommandEventId,
  };
}

function seedClosedSessions(
  db: DbConnection,
  hostId: string,
  scale: number,
): void {
  const count = scaled(CLOSED_SESSIONS, scale);
  db.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      openSession(db, {
        hostId,
        instanceId: `instance-${index}`,
        hostName: "query-costs-remote",
        dataDir: "/home/bb/.bb",
        protocolVersion: 42,
        heartbeatIntervalMs: 15_000,
        leaseTimeoutMs: 45_000,
      });
    }
  });
  const now = Date.now();
  db.update(hostDaemonSessions)
    .set({
      closedAt: sql`${now} - (${count} - rowid) * 3600000`,
      updatedAt: sql`${now} - (${count} - rowid) * 3600000`,
    })
    .where(
      and(
        eq(hostDaemonSessions.hostId, hostId),
        eq(hostDaemonSessions.status, "closed"),
      ),
    )
    .run();
}

function catalogModels(providerId: string): string {
  return JSON.stringify(
    Array.from({ length: 30 }, (_, index) => ({
      id: `${providerId}-model-${index}`,
      displayName: `${providerId} model ${index}`,
      reasoningLevels: ["low", "medium", "high", "xhigh"],
      contextWindow: 258_400,
      supportsImages: index % 2 === 0,
      description:
        "A capable model for long-running coding work with tool use and planning.",
    })),
  );
}

function seedProviderModelCatalogs(
  db: DbConnection,
  hostIds: readonly string[],
  scale: number,
): { catalogKey: CatalogKey; catalogFetchedAt: number } {
  const now = Date.now();
  const workspaces = scaled(WORKSPACE_CATALOG_SCOPES, scale);
  hostIds.forEach((hostId, hostIndex) => {
    const scopes = [
      "",
      ...Array.from(
        { length: hostIndex === 0 ? workspaces : 1 },
        (_, index) => `/workspace/project-${index}`,
      ),
    ];
    for (const providerId of PROVIDER_IDS) {
      scopes.forEach((scopeKey, scopeIndex) => {
        const modelsJson = catalogModels(providerId);
        replaceStoredProviderModelCatalog(db, {
          row: {
            hostId,
            providerId,
            scopeKey,
            fingerprint: `${providerId}-${scopeIndex}`,
            modelsJson,
            selectedOnlyModelsJson: "[]",
            fetchedAt: now - scopeIndex * DAY_MS,
          },
          pruneWorkspaceRowsFetchedBefore: null,
        });
      });
    }
  });
  const hostId = hostIds[0];
  if (hostId === undefined) throw new Error("Expected a catalog host");
  return {
    catalogKey: {
      hostId,
      providerId: PROVIDER_IDS[0],
      scopeKey: "/workspace/project-0",
    },
    catalogFetchedAt: now,
  };
}

function seedSweepFailures(db: DbConnection, scale: number): string[] {
  const now = Date.now();
  const stale: string[] = [];
  db.transaction((tx) => {
    ITEM_SWEEPS.forEach((sweep, sweepIndex) => {
      const count = scaled(SWEEP_FAILURE_SHARES[sweepIndex] ?? 0, scale);
      for (let index = 0; index < count; index += 1) {
        const itemKey = `thr_${sweepIndex}${String(index).padStart(9, "0")}`;
        const isStale = index % 3 === 0;
        if (sweepIndex === 0 && isStale) stale.push(itemKey);
        upsertSweepItemFailure(tx, {
          sweep,
          itemKey,
          attempts: 1 + (index % 12),
          firstFailedAt: now - (index + 1) * DAY_MS,
          retryAt: isStale ? now - 2 * DAY_MS : now + 60 * 60_000,
          lastError: "ENOTEMPTY: directory not empty, rmdir '/workspace/.bb'",
        });
      }
    });
    for (let index = 0; index < RETIRED_SWEEP_FAILURES; index += 1) {
      upsertSweepItemFailure(tx, {
        sweep: "legacy-environment-teardown",
        itemKey: `env_${index}`,
        attempts: 20,
        firstFailedAt: now - 90 * DAY_MS,
        retryAt: now - 60 * DAY_MS,
        lastError: "Environment provider is no longer installed",
      });
    }
  });
  return stale;
}

export function keybindingOverrides(): AppKeybindingOverrides {
  const appCommands: AppKeybindingOverrides = [
    {
      command: "thread.new",
      shortcut: {
        key: "n",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: true,
      },
    },
    { command: "thread.archive", shortcut: null },
    {
      command: "thread.search",
      platform: "linux",
      shortcut: {
        key: "k",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      },
    },
  ];
  const pluginCommands: AppKeybindingOverrides = Array.from(
    { length: 40 },
    (_, index) => ({
      command: `plugin:${PLUGIN_IDS[index % PLUGIN_IDS.length]}/command-${index}`,
      shortcut: {
        key: String.fromCharCode(97 + (index % 26)),
        mod: true,
        meta: false,
        control: false,
        alt: index % 2 === 0,
        shift: index % 3 === 0,
      },
    }),
  );
  return [...appCommands, ...pluginCommands];
}

function uiPreferenceValue(key: string, index: number): string {
  if (
    key.endsWith("Order") ||
    key.endsWith("Groups") ||
    key.endsWith("Items")
  ) {
    return JSON.stringify(
      Array.from({ length: 40 }, (_, item) => `${key}:${index}:${item}`),
    );
  }
  if (key.endsWith("Sections") || key.endsWith("Panels")) {
    return JSON.stringify(PLUGIN_IDS.map((pluginId) => `plugin:${pluginId}`));
  }
  return JSON.stringify(index % 2 === 0 ? "project" : true);
}

function seedSettings(db: DbConnection): void {
  setAppSettings(db, {
    ...defaultAppSettings,
    providerOrder: [...PROVIDER_IDS],
    defaultProviderId: PROVIDER_IDS[0],
    streamerMode: true,
    managedBranchPrefix: "bb/",
    onboardingCompletedAt: "2026-02-01T09:30:00.000Z",
    earlyAdopter: true,
  });
  setAppKeybindingOverrides(db, keybindingOverrides());
  setAiServiceSelection(db, "thread-title", {
    mode: "service",
    pluginId: "bb-cloud",
    serviceId: "titles",
  });
  setAiServiceSelection(db, "voice", { mode: "off" });
  setPluginSafeMode(db, false);
  setDisabledProviderIds(db, ["opencode", "plugin:slack/assistant"]);
  for (const pluginId of PLUGIN_IDS) {
    setDisabledPluginProviderCatalog(db, pluginId, [
      { id: `${pluginId}-assistant`, displayName: `${pluginId} assistant` },
      { id: `${pluginId}-reviewer`, displayName: `${pluginId} reviewer` },
    ]);
  }
  for (let index = 0; index < 30; index += 1) {
    setPluginRecommendationId(db, `plugin-${index}`, `recommendation-${index}`);
  }
  setSkippedAppUpdate(db, "2026.11.1");
  setAutoAppUpdate(db, true);
  setExperiments(db, {
    agentCpuPriority: true,
    threadContextCard: true,
    walCheckpointWorker: true,
    pluginUpdates: false,
  });
  setStoredAppearance(db, {
    themeId: "solarized-dark",
    faviconColor: "default",
  });
  UI_PREFERENCE_KEYS.forEach((key, index) => {
    replaceStoredUiPreference(db, {
      expectedRevision: 0,
      key,
      valueJson: uiPreferenceValue(key, index),
    });
    for (let revision = 0; revision < index % 4; revision += 1) {
      overwriteStoredUiPreference(db, {
        key,
        valueJson: uiPreferenceValue(key, index + revision),
      });
    }
  });
  db.insert(uiPreferenceDefaults)
    .values(
      UI_PREFERENCE_KEYS.slice(0, 6).map((key, index) => ({
        key,
        valueJson: uiPreferenceValue(key, index),
      })),
    )
    .onConflictDoNothing()
    .run();
}

function seedLegacyTables(db: DbConnection, scale: number): void {
  const tables: readonly [string, number][] = [
    ["client_turn_requests", scaled(LEGACY_TURN_REQUESTS, scale)],
    ["host_daemon_commands", scaled(LEGACY_COMMANDS, scale)],
    ["host_daemon_command_attempts", scaled(LEGACY_COMMANDS, scale)],
    ["thread_operations", scaled(LEGACY_OPERATIONS, scale)],
    ["environment_operations", scaled(LEGACY_OPERATIONS, scale)],
    ["project_operations", scaled(LEGACY_OPERATIONS / 10, scale)],
  ];
  const payload = JSON.stringify({
    method: "turn/start",
    params: { input: "Fix the failing build and rerun the targeted tests." },
    execution: { model: "gpt-5", reasoningLevel: "medium" },
  });
  db.transaction(() => {
    for (const [table, rows] of tables) {
      db.$client.exec(
        `CREATE TABLE ${table} (id TEXT PRIMARY KEY NOT NULL, thread_id TEXT, status TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL)`,
      );
      db.$client.exec(
        `CREATE INDEX ${table}_thread_idx ON ${table} (thread_id, created_at)`,
      );
      const insert = db.$client.prepare(
        `INSERT INTO ${table} (id, thread_id, status, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      );
      for (let index = 0; index < rows; index += 1) {
        insert.run(
          `${table}-${index}`,
          `thr_${index % 400}`,
          index % 20 === 0 ? "failed" : "completed",
          payload,
          1_700_000_000_000 + index * 60_000,
        );
      }
    }
  });
}

export function seedSettingsMaintenance(
  db: DbConnection,
  fixture: HistoryFixture,
  scale: number,
): SettingsMaintenanceSeed {
  const remoteHost = upsertHost(db, noopNotifier, {
    name: "query-costs-remote",
  });
  const rateLimitThread = seedRateLimitThread(db, fixture, scale);
  const interactions = seedPendingInteractions(db, fixture, scale);
  const retained = seedRetainedOutputs(db, fixture, scale);
  seedClosedSessions(db, remoteHost.id, scale);
  const catalogs = seedProviderModelCatalogs(
    db,
    [fixture.hostId, remoteHost.id],
    scale,
  );
  const staleSweepFailureKeys = seedSweepFailures(db, scale);
  seedSettings(db);
  seedLegacyTables(db, scale);
  return {
    remoteHostId: remoteHost.id,
    rateLimitThreadId: rateLimitThread.threadId,
    rateLimitLatestSequence: rateLimitThread.latestSequence,
    legacyImageEventId: rateLimitThread.legacyImageEventId,
    pendingProviderInteractionId: interactions.pendingProviderInteractionId,
    pendingProviderRequest: interactions.request,
    ...retained,
    staleSweepFailureKeys,
    ...catalogs,
  };
}
