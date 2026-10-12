import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { AUTOMATIONS_PLUGIN_ID } from "./catalog.js";
import type { LiveSignals, TipsAudience, TipsState } from "./engine.js";

const SIGNAL_TIMEOUT_MS = 5_000;
const WAITING_SCAN_LIMIT = 100;
const AUDIENCE_SCAN_LIMIT = 200;
export const NEW_USER_WINDOW_MS = 14 * 86_400_000;

export function classifyAudience(
  threadCount: number,
  createdAts: readonly number[],
  now: number,
): TipsAudience {
  if (threadCount === 0) return "new";
  if (threadCount > AUDIENCE_SCAN_LIMIT) return "existing";
  if (createdAts.length === 0) return "new";
  return now - Math.min(...createdAts) <= NEW_USER_WINDOW_MS
    ? "new"
    : "existing";
}

export async function readAudience(
  bb: BbPluginApi,
  now: number,
): Promise<TipsAudience> {
  const threadCount = await settle(
    bb,
    "the thread count",
    async (signal) => (await bb.sdk.threads.count({ signal })).total,
    0,
  );
  if (threadCount === 0 || threadCount > AUDIENCE_SCAN_LIMIT) {
    return classifyAudience(threadCount, [], now);
  }
  const createdAts = await settle(
    bb,
    "thread ages",
    async (signal) =>
      (
        await bb.sdk.threads.list({
          limit: AUDIENCE_SCAN_LIMIT,
          includeHidden: true,
          signal,
        })
      ).map((thread) => thread.createdAt),
    [],
  );
  return classifyAudience(threadCount, createdAts, now);
}

export interface WaitingThreadRow {
  status: string;
  hasPendingInteraction: boolean;
  lastReadAt: number | null;
  latestAttentionAt: number;
}

const RUNNING_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "starting",
  "active",
  "stopping",
]);

export function isWaitingOnUser(thread: WaitingThreadRow): boolean {
  if (thread.hasPendingInteraction) return true;
  if (RUNNING_STATUSES.has(thread.status)) return false;
  if (thread.status === "error") return true;
  return (thread.lastReadAt ?? 0) < thread.latestAttentionAt;
}

async function settle<T>(
  bb: BbPluginApi,
  label: string,
  read: (signal: AbortSignal) => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await read(AbortSignal.timeout(SIGNAL_TIMEOUT_MS));
  } catch (error) {
    bb.log.debug(
      `Could not read ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return fallback;
  }
}

export function createAppVersionReader(
  bb: BbPluginApi,
): () => Promise<string | null> {
  let cached: string | null = null;
  return async () => {
    if (cached !== null) return cached;
    const version = await settle(
      bb,
      "the app version",
      async (signal) =>
        (await bb.sdk.system.version({ signal })).currentVersion,
      null,
    );
    cached = version;
    return version;
  };
}

function hasThreads(
  bb: BbPluginApi,
  label: string,
  filter: { projectId?: string; hasParent?: boolean; originPluginId?: string },
): Promise<boolean> {
  return settle(
    bb,
    label,
    async (signal) =>
      (await bb.sdk.threads.list({ ...filter, limit: 1, signal })).length > 0,
    false,
  );
}

export async function collectLiveSignals(
  bb: BbPluginApi,
  state: TipsState,
  readAppVersion: () => Promise<string | null>,
  projectId: string | null,
): Promise<LiveSignals> {
  const [
    appVersion,
    threadCount,
    finishedThreadCount,
    availableProviderCount,
    installedPlugins,
    hasChildThread,
    hasAutomationThread,
    waitingThreadCount,
    projectHasChildThread,
    projectHasAutomationThread,
  ] = await Promise.all([
    readAppVersion(),
    settle(
      bb,
      "the thread count",
      async (signal) => (await bb.sdk.threads.count({ signal })).total,
      0,
    ),
    settle(
      bb,
      "the finished thread count",
      async (signal) =>
        (await bb.sdk.threads.count({ status: "idle", signal })).total,
      0,
    ),
    settle(
      bb,
      "available providers",
      async () =>
        (await bb.sdk.providers.catalog()).filter(
          (entry) => entry.pluginEnabled && entry.enabled && entry.available,
        ).length,
      0,
    ),
    settle(
      bb,
      "installed plugins",
      async (signal) =>
        Object.fromEntries(
          (await bb.sdk.plugins.list({ signal })).plugins.map((plugin) => [
            plugin.id,
            plugin.enabled,
          ]),
        ),
      {},
    ),
    state.observed.childThread
      ? Promise.resolve(true)
      : hasThreads(bb, "child threads", { hasParent: true }),
    state.observed.automationThread
      ? Promise.resolve(true)
      : hasThreads(bb, "automation threads", {
          originPluginId: AUTOMATIONS_PLUGIN_ID,
        }),
    settle(
      bb,
      "threads waiting on you",
      async (signal) =>
        (
          await bb.sdk.threads.list({ limit: WAITING_SCAN_LIMIT, signal })
        ).filter(isWaitingOnUser).length,
      0,
    ),
    projectId === null
      ? Promise.resolve(false)
      : hasThreads(bb, "this project's child threads", {
          projectId,
          hasParent: true,
        }),
    projectId === null
      ? Promise.resolve(false)
      : hasThreads(bb, "this project's automation threads", {
          projectId,
          originPluginId: AUTOMATIONS_PLUGIN_ID,
        }),
  ]);
  return {
    projectId,
    serverPlatform: process.platform,
    appVersion,
    threadCount,
    finishedThreadCount,
    hasChildThread,
    hasAutomationThread,
    projectHasChildThread,
    projectHasAutomationThread,
    waitingThreadCount,
    availableProviderCount,
    installedPlugins,
  };
}
