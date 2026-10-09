import { z } from "zod";
import {
  TIP_CATALOG,
  renderTip,
  type TipDefinition,
  type TipTier,
  type TipSignals,
} from "./catalog.js";
import {
  FEED_SIZE,
  tipRetiredReasonSchema,
  type TipClient,
  type TipListEntry,
  type TipStatus,
} from "./contract.js";

const DAY_MS = 86_400_000;
const RECENT_RATE_LIMIT_MS = 14 * DAY_MS;
export const VISIT_DEBOUNCE_MS = 10 * 60_000;

const tipRecordSchema = z
  .object({
    shownCount: z.number().int().nonnegative(),
    lastShownAt: z.number().nullable(),
    dismissedAt: z.number().nullable(),
    actedAt: z.number().nullable(),
    retiredAt: z.number().nullable(),
    retiredReason: tipRetiredReasonSchema.nullable(),
  })
  .strict();
export type TipRecord = z.infer<typeof tipRecordSchema>;

const tipsFeedSchema = z
  .object({
    keys: z.array(z.string()),
    visitedAt: z.number(),
  })
  .strict();
export type TipsFeed = z.infer<typeof tipsFeedSchema>;

export const tipsAudienceSchema = z.enum(["new", "existing"]);
export type TipsAudience = z.infer<typeof tipsAudienceSchema>;

export const tipsStateSchema = z
  .object({
    version: z.literal(3),
    firstSeenAt: z.number(),
    firstSeenVersion: z.string().nullable(),
    feed: tipsFeedSchema.nullable(),
    cycle: z.array(z.string()),
    hiddenDay: z.string().nullable(),
    audience: tipsAudienceSchema.nullable(),
    records: z.record(z.string(), tipRecordSchema),
    observed: z
      .object({
        finishedThread: z.boolean(),
        childThread: z.boolean(),
        automationThread: z.boolean(),
        rateLimitedAt: z.number().nullable(),
        queuedFollowUpAt: z.number().nullable(),
        mobileAppAt: z.number().nullable(),
      })
      .strict(),
  })
  .strict();
export type TipsState = z.infer<typeof tipsStateSchema>;

export interface LiveSignals {
  projectId: string | null;
  serverPlatform: string;
  appVersion: string | null;
  threadCount: number;
  finishedThreadCount: number;
  hasChildThread: boolean;
  hasAutomationThread: boolean;
  projectHasChildThread: boolean;
  projectHasAutomationThread: boolean;
  waitingThreadCount: number;
  availableProviderCount: number;
  installedPlugins: Readonly<Record<string, boolean>>;
}

export class UnknownTipError extends Error {
  constructor(id: string) {
    super(`Unknown tip: ${id}`);
    this.name = "UnknownTipError";
  }
}

const EMPTY_RECORD: TipRecord = {
  shownCount: 0,
  lastShownAt: null,
  dismissedAt: null,
  actedAt: null,
  retiredAt: null,
  retiredReason: null,
};

export function localDay(now: number): string {
  const date = new Date(now);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function createTipsState(
  now: number,
  appVersion: string | null,
): TipsState {
  return {
    version: 3,
    firstSeenAt: now,
    firstSeenVersion: appVersion,
    feed: null,
    cycle: [],
    hiddenDay: null,
    audience: null,
    records: {},
    observed: {
      finishedThread: false,
      childThread: false,
      automationThread: false,
      rateLimitedAt: null,
      queuedFollowUpAt: null,
      mobileAppAt: null,
    },
  };
}

export function parseTipsState(value: unknown): TipsState | null {
  const parsed = tipsStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function observeLiveSignals(
  state: TipsState,
  live: LiveSignals,
  client: TipClient | null,
  now: number,
): TipsState {
  return {
    ...state,
    firstSeenVersion: state.firstSeenVersion ?? live.appVersion,
    observed: {
      ...state.observed,
      finishedThread:
        state.observed.finishedThread || live.finishedThreadCount > 0,
      childThread: state.observed.childThread || live.hasChildThread,
      automationThread:
        state.observed.automationThread || live.hasAutomationThread,
      mobileAppAt:
        state.observed.mobileAppAt ??
        (client?.surface === "mobile-app" ? now : null),
    },
  };
}

export function deriveSignals(
  state: TipsState,
  live: LiveSignals,
  client: TipClient | null,
  now: number,
): TipSignals {
  return {
    client,
    projectId: live.projectId,
    serverPlatform: live.serverPlatform,
    appVersion: live.appVersion,
    firstSeenVersion: state.firstSeenVersion,
    daysSinceFirstSeen: Math.max(
      0,
      Math.floor((now - state.firstSeenAt) / DAY_MS),
    ),
    threadCount: live.threadCount,
    availableProviderCount: live.availableProviderCount,
    installedPlugins: live.installedPlugins,
    hasFinishedThread:
      state.observed.finishedThread || live.finishedThreadCount > 0,
    finishedThreadCount: live.finishedThreadCount,
    hasChildThread: state.observed.childThread || live.hasChildThread,
    hasAutomationThread:
      state.observed.automationThread || live.hasAutomationThread,
    projectHasChildThread: live.projectHasChildThread,
    projectHasAutomationThread: live.projectHasAutomationThread,
    waitingThreadCount: live.waitingThreadCount,
    rateLimited: state.observed.rateLimitedAt !== null,
    recentlyRateLimited:
      state.observed.rateLimitedAt !== null &&
      now - state.observed.rateLimitedAt <= RECENT_RATE_LIMIT_MS,
    queuedFollowUp: state.observed.queuedFollowUpAt !== null,
    usedMobileApp: state.observed.mobileAppAt !== null,
  };
}

export function findTip(
  id: string,
  catalog: readonly TipDefinition[] = TIP_CATALOG,
): TipDefinition | null {
  return catalog.find((definition) => definition.id === id) ?? null;
}

export function recordKey(
  definition: TipDefinition,
  appVersion: string | null,
): string {
  return definition.perVersion
    ? `${definition.id}@${appVersion ?? "unknown"}`
    : definition.id;
}

function recordFor(
  state: TipsState,
  definition: TipDefinition,
  signals: TipSignals,
): TipRecord {
  return (
    state.records[recordKey(definition, signals.appVersion)] ?? EMPTY_RECORD
  );
}

function withRecord(
  state: TipsState,
  key: string,
  update: (record: TipRecord) => TipRecord,
): TipsState {
  return {
    ...state,
    records: {
      ...state.records,
      [key]: update(state.records[key] ?? EMPTY_RECORD),
    },
  };
}

function versionParts(version: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  return match === null ? null : match.slice(1, 4).map(Number);
}

export function compareVersions(left: string, right: string): number | null {
  const a = versionParts(left);
  const b = versionParts(right);
  if (a === null || b === null) return null;
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function isExpired(
  definition: TipDefinition,
  appVersion: string | null,
): boolean {
  if (definition.expiresAt === undefined || appVersion === null) return false;
  const comparison = compareVersions(appVersion, definition.expiresAt);
  return comparison !== null && comparison >= 0;
}

export function evaluateTip(
  definition: TipDefinition,
  state: TipsState,
  signals: TipSignals,
): Exclude<TipStatus, "in-feed"> {
  if (definition.held) return "held";
  if (isExpired(definition, signals.appVersion)) return "expired";
  const record = recordFor(state, definition, signals);
  if (record.dismissedAt !== null) return "dismissed";
  if (record.retiredAt !== null) return "retired";
  return definition.eligible(signals) ? "eligible" : "not-applicable";
}

export function retireTips(
  state: TipsState,
  signals: TipSignals,
  now: number,
  catalog: readonly TipDefinition[] = TIP_CATALOG,
): TipsState {
  let next = state;
  for (const definition of catalog) {
    if (definition.held) continue;
    const key = recordKey(definition, signals.appVersion);
    const record = next.records[key] ?? EMPTY_RECORD;
    if (record.dismissedAt !== null || record.retiredAt !== null) continue;
    if (definition.retireWhen(signals)) {
      next = withRecord(next, key, (current) => ({
        ...current,
        retiredAt: now,
        retiredReason: "used",
      }));
    }
  }
  return next;
}

const TIER_ORDER: Record<TipTier, number> = {
  1: 0,
  unranked: 1,
  2: 2,
  3: 3,
};

export function tierOrder(tier: TipTier): number {
  return TIER_ORDER[tier];
}

export function rankEligibleTips(
  state: TipsState,
  signals: TipSignals,
  catalog: readonly TipDefinition[] = TIP_CATALOG,
): TipDefinition[] {
  return catalog
    .map((definition, index) => ({ definition, index }))
    .filter(
      ({ definition }) =>
        evaluateTip(definition, state, signals) === "eligible",
    )
    .sort(
      (left, right) =>
        tierOrder(left.definition.tier) - tierOrder(right.definition.tier) ||
        right.definition.boost(signals) - left.definition.boost(signals) ||
        right.definition.priority - left.definition.priority ||
        left.index - right.index,
    )
    .map(({ definition }) => definition);
}

export interface TipFeedResult {
  state: TipsState;
  tips: TipDefinition[];
}

function keyOf(definition: TipDefinition, signals: TipSignals): string {
  return recordKey(definition, signals.appVersion);
}

function clickedSince(state: TipsState, key: string, since: number): boolean {
  const actedAt = state.records[key]?.actedAt ?? null;
  return actedAt !== null && actedAt >= since;
}

function pickFresh(
  state: TipsState,
  ranked: readonly TipDefinition[],
  exclude: ReadonlySet<string>,
  count: number,
  signals: TipSignals,
): { picks: TipDefinition[]; cycle: string[] } {
  const candidates = ranked.filter(
    (definition) => !exclude.has(keyOf(definition, signals)),
  );
  if (count === 0 || candidates.length === 0) {
    return { picks: [], cycle: state.cycle };
  }
  const unseen = candidates.filter(
    (definition) => !state.cycle.includes(keyOf(definition, signals)),
  );
  if (unseen.length >= count) {
    const picks = unseen.slice(0, count);
    return {
      picks,
      cycle: [
        ...state.cycle,
        ...picks.map((definition) => keyOf(definition, signals)),
      ],
    };
  }
  const repeats = candidates
    .filter((definition) => !definition.perVersion)
    .filter((definition) => !unseen.includes(definition))
    .sort((left, right) => {
      const leftShown = state.records[keyOf(left, signals)]?.lastShownAt ?? 0;
      const rightShown = state.records[keyOf(right, signals)]?.lastShownAt ?? 0;
      return leftShown - rightShown;
    });
  const picks = [...unseen, ...repeats].slice(0, count);
  return {
    picks,
    cycle: picks.map((definition) => keyOf(definition, signals)),
  };
}

function markShown(
  state: TipsState,
  definitions: readonly TipDefinition[],
  signals: TipSignals,
  now: number,
): TipsState {
  let next = state;
  for (const definition of definitions) {
    next = withRecord(next, keyOf(definition, signals), (record) => ({
      ...record,
      shownCount: record.shownCount + 1,
      lastShownAt: now,
    }));
  }
  return next;
}

export function visitFeed(
  state: TipsState,
  signals: TipSignals,
  now: number,
  visit: boolean,
  catalog: readonly TipDefinition[] = TIP_CATALOG,
): TipFeedResult {
  const retired = retireTips(state, signals, now, catalog);
  if (retired.hiddenDay === localDay(now)) return { state: retired, tips: [] };
  const ranked = rankEligibleTips(retired, signals, catalog);
  const byKey = new Map(
    ranked.map((definition) => [keyOf(definition, signals), definition]),
  );
  const feed = retired.feed;
  const recent =
    feed !== null && (!visit || now - feed.visitedAt < VISIT_DEBOUNCE_MS);
  const survivors = (feed?.keys ?? [])
    .filter((key) => byKey.has(key))
    .filter(
      (key) =>
        recent || feed === null || !clickedSince(retired, key, feed.visitedAt),
    );
  const unchanged =
    recent && feed !== null && survivors.length === feed.keys.length;
  const needed = recent
    ? FEED_SIZE - survivors.length
    : Math.max(1, FEED_SIZE - survivors.length);
  const tipsFor = (keys: readonly string[]) =>
    keys.flatMap((key) => {
      const definition = byKey.get(key);
      return definition === undefined ? [] : [definition];
    });
  if (unchanged && needed <= 0) {
    return { state: retired, tips: tipsFor(survivors) };
  }
  const clicked =
    recent || feed === null
      ? []
      : feed.keys.filter((key) => clickedSince(retired, key, feed.visitedAt));
  const { picks, cycle } = pickFresh(
    retired,
    ranked,
    new Set([...survivors, ...clicked]),
    Math.max(0, needed),
    signals,
  );
  const keys = [
    ...picks.map((definition) => keyOf(definition, signals)),
    ...survivors,
  ].slice(0, FEED_SIZE);
  const next: TipsState = {
    ...markShown(retired, picks, signals, now),
    cycle,
    feed: {
      keys,
      visitedAt: recent && feed !== null ? feed.visitedAt : now,
    },
  };
  return { state: next, tips: tipsFor(keys) };
}

export function hideTips(
  state: TipsState,
  hidden: boolean,
  today: string,
): TipsState {
  return { ...state, hiddenDay: hidden ? today : null };
}

export function dismissTip(
  state: TipsState,
  id: string,
  appVersion: string | null,
  now: number,
  catalog: readonly TipDefinition[] = TIP_CATALOG,
): TipsState {
  const definition = findTip(id, catalog);
  if (definition === null) throw new UnknownTipError(id);
  return withRecord(state, recordKey(definition, appVersion), (record) => ({
    ...record,
    dismissedAt: record.dismissedAt ?? now,
  }));
}

export function actOnTip(
  state: TipsState,
  id: string,
  appVersion: string | null,
  now: number,
  catalog: readonly TipDefinition[] = TIP_CATALOG,
): TipsState {
  const definition = findTip(id, catalog);
  if (definition === null) throw new UnknownTipError(id);
  return withRecord(state, recordKey(definition, appVersion), (record) => ({
    ...record,
    actedAt: now,
  }));
}

export function resetTips(state: TipsState): TipsState {
  return { ...state, feed: null, cycle: [], hiddenDay: null, records: {} };
}

export function listTips(
  state: TipsState,
  signals: TipSignals,
  today: string,
  all: boolean,
  catalog: readonly TipDefinition[] = TIP_CATALOG,
): TipListEntry[] {
  const inFeed = state.hiddenDay === today ? [] : (state.feed?.keys ?? []);
  const position = (definition: TipDefinition) => {
    const index = inFeed.indexOf(recordKey(definition, signals.appVersion));
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };
  return [...catalog]
    .sort(
      (left, right) =>
        position(left) - position(right) ||
        tierOrder(left.tier) - tierOrder(right.tier) ||
        right.priority - left.priority,
    )
    .flatMap((definition) => {
      const record = recordFor(state, definition, signals);
      const evaluated = evaluateTip(definition, state, signals);
      const status: TipStatus =
        evaluated === "eligible" && Number.isFinite(position(definition))
          ? "in-feed"
          : evaluated;
      if (!all && status !== "in-feed" && status !== "eligible") return [];
      return [
        {
          ...renderTip(definition, signals),
          status,
          shownCount: record.shownCount,
          dismissed: record.dismissedAt !== null,
          acted: record.actedAt !== null,
          retiredReason: record.retiredReason,
        },
      ];
    });
}
