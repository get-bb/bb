import { randomUUID } from "node:crypto";
import type {
  Account,
  AccountPoolConfig,
  CacheMissCause,
  CacheMissDivergence,
  CacheMissReport,
  CacheMissUsage,
  PoolProvider,
} from "./contracts.js";
import { firstDifference } from "./cache-miss-excerpt.js";
import {
  decodeRequestBody,
  diffPrompts,
  parameterMembers,
  parsePrompt,
  sharedPrefixLength,
  type DiffSegment,
  type PromptLevel,
  type PromptRequestKind,
  type PromptSegment,
  type PromptShape,
} from "./cache-miss-prompt.js";
import { createUsageTap } from "./cache-miss-usage.js";

const ROUTE_PATHS: Readonly<Record<PoolProvider, string>> = {
  claude: "/v1/messages",
  codex: "/v1/responses",
};
const DEFAULT_MAX_REPORTS = 50;
const DEFAULT_MAX_SNAPSHOTS_PER_LINEAGE = 8;
const DEFAULT_MAX_SUBAGENTS_PER_CONVERSATION = 16;
const DEFAULT_MAX_CONVERSATIONS = 64;
const DEFAULT_MAX_RETAINED_BYTES = 32 * 1024 * 1024;
const TEXT_ENTRY_BYTES = 256;
const SEGMENT_ENTRY_BYTES = 128;
const SNAPSHOT_ENTRY_BYTES = 512;
const PARAM_ENTRY_BYTES = 64;
const REFERENCE_BYTES = 8;
const LOOKBACK_POSITIONS = 20;
const MAX_PARAM_VALUE_LENGTH = 80;
const PARAM_VALUE_CONTEXT = 24;
const AFFINITY_PREFIX = /^(?:session|cache):/u;

export interface CacheMissMonitorOptions {
  now: () => number;
  settings: () => AccountPoolConfig;
  onReport: (report: CacheMissReport) => void;
  randomId?: () => string;
  maxReports?: number;
  maxSnapshotsPerLineage?: number;
  maxSubagentsPerConversation?: number;
  maxConversations?: number;
  maxRetainedBytes?: number;
}

export interface CacheMissBeginInput {
  provider: PoolProvider;
  routePath: string;
  body: Uint8Array;
  headers: Headers;
  hostId: string;
  affinityId: string | null;
  affinityKey: string | null;
  parentAffinityKey: string | null;
}

export interface CacheMissObserver {
  chunk(bytes: Uint8Array): void;
  end(): void;
  abort(): void;
}

export interface CacheMissRequest {
  observe(
    account: Account,
    response: Response,
    startedAt: number,
  ): CacheMissObserver;
}

interface PendingRequest {
  provider: PoolProvider;
  hostId: string;
  affinityId: string;
  affinityKey: string;
  parentAffinityKey: string | null;
}

type PromptSource =
  | { kind: "raw"; body: Uint8Array; headers: Headers }
  | { kind: "parsed"; shape: PromptShape | null };

interface ObservedResponse {
  accountId: string;
  accountLabel: string;
  usage: CacheMissUsage;
  startedAt: number;
  firstChunkAt: number;
}

interface RequestFacts {
  startedAt: number;
  firstChunkAt: number;
  observedAt: number;
  accountId: string;
  accountLabel: string;
  model: string | null;
  usage: CacheMissUsage;
  params: ReadonlyMap<string, string>;
  lastBreakpointPosition: number | null;
  cacheTtlMs: number;
  requestKind: PromptRequestKind;
  subagentLineage: string | null;
  historyLength: number;
  windowNumber: number | null;
}

interface SnapshotSegment {
  level: PromptLevel;
  path: string;
  label: string | null;
  hash: string;
  refs: number;
}

interface Snapshot extends RequestFacts {
  segments: SnapshotSegment[];
  bytes: number;
}

interface RetainedText {
  hash: string;
  text: string;
  bytes: number;
  refs: number;
}

const NOOP_OBSERVER: CacheMissObserver = {
  chunk() {},
  end() {},
  abort() {},
};

const DISCARDED_PROMPT: PromptSource = { kind: "parsed", shape: null };

export class CacheMissMonitor {
  private readonly now: () => number;
  private readonly settings: () => AccountPoolConfig;
  private readonly onReport: (report: CacheMissReport) => void;
  private readonly randomId: () => string;
  private readonly maxReports: number;
  private readonly maxSnapshotsPerLineage: number;
  private readonly maxSubagentsPerConversation: number;
  private readonly maxConversations: number;
  private readonly maxRetainedBytes: number;
  private readonly recentReports: CacheMissReport[] = [];
  private readonly conversations = new Map<string, Snapshot[]>();
  private readonly texts = new Map<string, RetainedText>();
  private retainedBytes = 0;

  constructor(options: CacheMissMonitorOptions) {
    this.now = options.now;
    this.settings = options.settings;
    this.onReport = options.onReport;
    this.randomId = options.randomId ?? (() => randomUUID());
    this.maxReports = options.maxReports ?? DEFAULT_MAX_REPORTS;
    this.maxSnapshotsPerLineage =
      options.maxSnapshotsPerLineage ?? DEFAULT_MAX_SNAPSHOTS_PER_LINEAGE;
    this.maxSubagentsPerConversation =
      options.maxSubagentsPerConversation ??
      DEFAULT_MAX_SUBAGENTS_PER_CONVERSATION;
    this.maxConversations =
      options.maxConversations ?? DEFAULT_MAX_CONVERSATIONS;
    this.maxRetainedBytes =
      options.maxRetainedBytes ?? DEFAULT_MAX_RETAINED_BYTES;
  }

  begin(input: CacheMissBeginInput): CacheMissRequest | null {
    try {
      if (!this.settings().cacheMissDebug) return null;
      if (
        input.routePath !== ROUTE_PATHS[input.provider] ||
        input.affinityKey === null ||
        input.affinityId === null
      )
        return null;
      return this.track(
        {
          provider: input.provider,
          hostId: input.hostId,
          affinityId: input.affinityId,
          affinityKey: input.affinityKey,
          parentAffinityKey: input.parentAffinityKey,
        },
        { kind: "raw", body: input.body, headers: input.headers },
      );
    } catch {
      return null;
    }
  }

  reports(): CacheMissReport[] {
    return [...this.recentReports];
  }

  clearReports(): number {
    const count = this.recentReports.length;
    this.recentReports.length = 0;
    return count;
  }

  clearSnapshots(): void {
    this.conversations.clear();
    this.texts.clear();
    this.retainedBytes = 0;
  }

  private track(
    pending: PendingRequest,
    source: PromptSource,
  ): CacheMissRequest {
    let unobserved: PromptSource | null = source;
    return {
      observe: (account, response, startedAt) => {
        const prompt = unobserved;
        unobserved = null;
        if (prompt === null) return NOOP_OBSERVER;
        try {
          return this.observer(pending, prompt, account, response, startedAt);
        } catch {
          return NOOP_OBSERVER;
        }
      },
    };
  }

  private observer(
    pending: PendingRequest,
    source: PromptSource,
    account: Account,
    response: Response,
    startedAt: number,
  ): CacheMissObserver {
    const tap = createUsageTap(
      pending.provider,
      response.headers.get("content-type"),
    );
    const accountId = account.id;
    const accountLabel = account.label;
    let prompt = source;
    let open = true;
    let firstChunkAt: number | null = null;
    const shape = (): PromptShape | null => {
      if (prompt.kind === "raw")
        prompt = {
          kind: "parsed",
          shape: trackedPromptShape(
            pending.provider,
            prompt.body,
            prompt.headers,
          ),
        };
      return prompt.shape;
    };
    const discard = (): void => {
      open = false;
      prompt = DISCARDED_PROMPT;
    };
    return {
      chunk: (bytes) => {
        if (!open) return;
        try {
          if (firstChunkAt === null) {
            firstChunkAt = this.now();
            setImmediate(() => {
              if (!open) return;
              try {
                if (this.settings().cacheMissDebug) shape();
              } catch {
                discard();
              }
            });
          }
          tap.push(bytes);
        } catch {
          discard();
        }
      },
      end: () => {
        if (!open) return;
        open = false;
        try {
          const usage = tap.finish();
          if (usage !== null && firstChunkAt !== null)
            this.complete(pending, shape, {
              accountId,
              accountLabel,
              usage,
              startedAt,
              firstChunkAt,
            });
        } catch {}
        prompt = DISCARDED_PROMPT;
      },
      abort: discard,
    };
  }

  private complete(
    pending: PendingRequest,
    shape: () => PromptShape | null,
    observed: ObservedResponse,
  ): void {
    const settings = this.settings();
    if (!settings.cacheMissDebug) return;
    const prompt = shape();
    if (prompt === null) return;
    const current: RequestFacts = {
      startedAt: observed.startedAt,
      firstChunkAt: observed.firstChunkAt,
      observedAt: this.now(),
      accountId: observed.accountId,
      accountLabel: observed.accountLabel,
      model: prompt.model,
      usage: observed.usage,
      params: prompt.params,
      lastBreakpointPosition: prompt.lastBreakpointPosition,
      cacheTtlMs: prompt.cacheTtlMs,
      requestKind: prompt.requestKind,
      subagentLineage: prompt.subagentLineage,
      historyLength: prompt.historyLength,
      windowNumber: prompt.windowNumber,
    };
    const previous = this.predecessor(pending, current, prompt);
    if (previous !== null) {
      const report = this.analyze(
        pending,
        prompt.segments,
        current,
        previous,
        settings.cacheMissMinTokens,
      );
      if (report !== null) this.publish(report);
    }
    this.store(pending.affinityKey, current, prompt.segments, previous);
  }

  private predecessor(
    pending: PendingRequest,
    current: RequestFacts,
    prompt: PromptShape,
  ): Snapshot | null {
    const sources =
      pending.parentAffinityKey === null ||
      pending.parentAffinityKey === pending.affinityKey
        ? [{ key: pending.affinityKey, fork: false }]
        : [
            { key: pending.parentAffinityKey, fork: true },
            { key: pending.affinityKey, fork: false },
          ];
    let best: Snapshot | null = null;
    let bestShared = -1;
    let bestContained = false;
    for (const { key, fork } of sources) {
      for (const candidate of this.conversations.get(key) ?? []) {
        if (
          candidate.startedAt > current.startedAt ||
          candidate.subagentLineage !== current.subagentLineage
        )
          continue;
        const shared = sharedPrefixLength(candidate.segments, prompt.segments);
        const contained = shared === candidate.segments.length;
        if (fork && !contained) continue;
        if (
          best === null ||
          shared > bestShared ||
          (shared === bestShared &&
            (contained === bestContained
              ? candidate.startedAt >= best.startedAt
              : contained))
        ) {
          best = candidate;
          bestShared = shared;
          bestContained = contained;
        }
      }
    }
    return best;
  }

  private analyze(
    pending: PendingRequest,
    segments: readonly PromptSegment[],
    current: RequestFacts,
    previous: Snapshot,
    minTokens: number,
  ): CacheMissReport | null {
    const expectedCachedTokens = Math.min(
      pending.provider === "claude"
        ? previous.usage.cacheReadTokens +
            (previous.usage.cacheWriteTokens ?? 0)
        : previous.usage.promptTokens,
      current.usage.promptTokens,
    );
    const missedTokens = Math.max(
      0,
      expectedCachedTokens - current.usage.cacheReadTokens,
    );
    if (missedTokens < minTokens) return null;
    const divergence = diffPrompts(this.retainedSegments(previous), segments);
    return {
      id: this.randomId(),
      observedAt: current.observedAt,
      provider: pending.provider,
      model: current.model,
      sessionId: pending.affinityId.replace(AFFINITY_PREFIX, ""),
      hostId: pending.hostId,
      hostName: null,
      accountId: current.accountId,
      accountLabel: current.accountLabel,
      previous: {
        observedAt: previous.observedAt,
        accountId: previous.accountId,
        accountLabel: previous.accountLabel,
        model: previous.model,
        usage: previous.usage,
      },
      usage: current.usage,
      expectedCachedTokens,
      missedTokens,
      causes: missCauses(pending.provider, previous, current, divergence),
      divergence,
    };
  }

  private retainedSegments(snapshot: Snapshot): DiffSegment[] {
    return snapshot.segments.map(({ level, path, label, hash }) => ({
      level,
      path,
      label,
      hash,
      text: this.texts.get(hash)?.text ?? "",
    }));
  }

  private publish(report: CacheMissReport): void {
    this.recentReports.unshift(report);
    if (this.recentReports.length > this.maxReports)
      this.recentReports.length = this.maxReports;
    try {
      this.onReport(report);
    } catch {}
  }

  private store(
    key: string,
    facts: RequestFacts,
    segments: readonly PromptSegment[],
    previous: Snapshot | null,
  ): void {
    const snapshot: Snapshot = {
      ...facts,
      segments: this.snapshotSegments(segments, previous),
      bytes: snapshotBytes(facts, segments.length),
    };
    this.retainedBytes += snapshot.bytes;
    const snapshots = this.conversations.get(key) ?? [];
    this.conversations.delete(key);
    this.conversations.set(key, snapshots);
    snapshots.push(snapshot);
    const lineage = snapshots.filter(
      (stored) => stored.subagentLineage === snapshot.subagentLineage,
    );
    if (lineage.length > this.maxSnapshotsPerLineage) {
      const oldest = lineage[0];
      this.dropSnapshots(snapshots, (stored) => stored === oldest);
    }
    const stalest = stalestSubagent(
      snapshots,
      this.maxSubagentsPerConversation,
    );
    if (stalest !== null)
      this.dropSnapshots(
        snapshots,
        (stored) => stored.subagentLineage === stalest,
      );
    while (this.conversations.size > this.maxConversations)
      this.evictLeastRecentConversation();
    while (
      this.retainedBytes > this.maxRetainedBytes &&
      this.conversations.size > 0
    )
      this.evictLeastRecentConversation();
  }

  private snapshotSegments(
    segments: readonly PromptSegment[],
    previous: Snapshot | null,
  ): SnapshotSegment[] {
    const reusable = previous?.segments ?? [];
    let sharing = true;
    return segments.map((segment, index) => {
      const earlier = index < reusable.length ? reusable[index] : null;
      sharing =
        sharing &&
        earlier !== null &&
        earlier.hash === segment.hash &&
        earlier.level === segment.level &&
        earlier.path === segment.path &&
        earlier.label === segment.label;
      const retained =
        sharing && earlier !== null ? earlier : this.createSegment(segment);
      retained.refs += 1;
      return retained;
    });
  }

  private createSegment(segment: PromptSegment): SnapshotSegment {
    const text = this.retainText(segment);
    const created: SnapshotSegment = {
      level: segment.level,
      path: segment.path,
      label: segment.label,
      hash: text.hash,
      refs: 0,
    };
    this.retainedBytes += segmentBytes(created);
    return created;
  }

  private retainText(segment: PromptSegment): RetainedText {
    const existing = this.texts.get(segment.hash);
    if (existing !== undefined) {
      existing.refs += 1;
      return existing;
    }
    const created: RetainedText = {
      hash: segment.hash,
      text: segment.text,
      bytes: TEXT_ENTRY_BYTES + Buffer.byteLength(segment.text, "utf8"),
      refs: 1,
    };
    this.texts.set(segment.hash, created);
    this.retainedBytes += created.bytes;
    return created;
  }

  private release(snapshot: Snapshot): void {
    this.retainedBytes -= snapshot.bytes;
    for (const segment of snapshot.segments) {
      segment.refs -= 1;
      if (segment.refs > 0) continue;
      this.retainedBytes -= segmentBytes(segment);
      const text = this.texts.get(segment.hash);
      if (text === undefined) continue;
      text.refs -= 1;
      if (text.refs > 0) continue;
      this.texts.delete(segment.hash);
      this.retainedBytes -= text.bytes;
    }
  }

  private dropSnapshots(
    snapshots: Snapshot[],
    dropped: (snapshot: Snapshot) => boolean,
  ): void {
    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
      const snapshot = snapshots[index];
      if (!dropped(snapshot)) continue;
      snapshots.splice(index, 1);
      this.release(snapshot);
    }
  }

  private evictLeastRecentConversation(): void {
    const oldest = this.conversations.entries().next();
    if (oldest.done === true) return;
    const [key, snapshots] = oldest.value;
    this.conversations.delete(key);
    for (const snapshot of snapshots) this.release(snapshot);
  }
}

function stalestSubagent(
  snapshots: readonly Snapshot[],
  limit: number,
): string | null {
  const recency = new Set<string>();
  for (const { subagentLineage } of snapshots) {
    if (subagentLineage === null) continue;
    recency.delete(subagentLineage);
    recency.add(subagentLineage);
  }
  if (recency.size <= limit) return null;
  const [stalest] = recency;
  return stalest;
}

function segmentBytes(segment: SnapshotSegment): number {
  return (
    SEGMENT_ENTRY_BYTES + segment.path.length + (segment.label?.length ?? 0)
  );
}

function snapshotBytes(facts: RequestFacts, segmentCount: number): number {
  let bytes =
    SNAPSHOT_ENTRY_BYTES +
    segmentCount * REFERENCE_BYTES +
    (facts.subagentLineage?.length ?? 0);
  for (const [name, value] of facts.params)
    bytes += PARAM_ENTRY_BYTES + name.length + value.length;
  return bytes;
}

function trackedPromptShape(
  provider: PoolProvider,
  body: Uint8Array,
  headers: Headers,
): PromptShape | null {
  const decoded = decodeRequestBody(body, headers.get("content-encoding"));
  if (decoded === null) return null;
  const shape = parsePrompt(provider, decoded, headers);
  if (
    shape === null ||
    (provider === "claude" && shape.lastBreakpointPosition === null)
  )
    return null;
  return shape;
}

function missCauses(
  provider: PoolProvider,
  previous: RequestFacts,
  current: RequestFacts,
  divergence: CacheMissDivergence | null,
): CacheMissCause[] {
  const causes: CacheMissCause[] = [];
  if (previous.accountId !== current.accountId) {
    causes.push({
      kind: "account-switch",
      message: `This request went to account ${current.accountLabel}, but the previous request went to ${previous.accountLabel}. Prompt caches are isolated per organization, so the earlier cache was not reachable.`,
    });
  }
  if (previous.model !== current.model) {
    causes.push({
      kind: "model-change",
      message: `The model changed from ${describeModel(previous.model)} to ${describeModel(current.model)}. Prompt caches are not shared across models.`,
    });
  }
  const gap = current.startedAt - previous.startedAt;
  if (gap > previous.cacheTtlMs) {
    causes.push({
      kind: "idle-gap",
      message:
        provider === "claude"
          ? `${formatDuration(gap)} passed since the previous request started, longer than its ${formatDuration(previous.cacheTtlMs)} cache lifetime.`
          : `${formatDuration(gap)} passed since the previous request started, longer than the ${formatDuration(previous.cacheTtlMs)} cache lifetime. OpenAI documents at least 30 minutes of cached-prefix retention for GPT-5.6 and later, and older models can drop prefixes after 5 to 10 idle minutes.`,
    });
  }
  if (current.startedAt < previous.firstChunkAt) {
    causes.push({
      kind: "concurrent-request",
      message:
        "This request started before the previous response began. A cache entry becomes available only once the earlier response begins.",
    });
  }
  const changes = parameterChanges(previous.params, current.params);
  if (changes.length > 0) {
    causes.push({
      kind: "parameter-change",
      message: `Request parameters changed: ${changes.join("; ")}.`,
    });
  }
  if (
    previous.requestKind === "compaction" ||
    current.requestKind === "compaction" ||
    (previous.windowNumber !== null &&
      current.windowNumber !== null &&
      previous.windowNumber !== current.windowNumber) ||
    (divergence?.change === "removed" &&
      (divergence.level === "messages" || divergence.level === "input")) ||
    current.historyLength < previous.historyLength
  ) {
    causes.push({
      kind: "compaction",
      message:
        "History was rewritten (compaction, rewind, or cleared context).",
    });
  }
  if (divergence !== null) {
    causes.push({
      kind: "prompt-change",
      message: promptChangeMessage(divergence),
    });
  }
  if (
    provider === "claude" &&
    divergence === null &&
    previous.lastBreakpointPosition !== null &&
    current.lastBreakpointPosition !== null &&
    current.lastBreakpointPosition - previous.lastBreakpointPosition >=
      LOOKBACK_POSITIONS
  ) {
    causes.push({
      kind: "lookback-window",
      message: `The cache breakpoint moved ${current.lastBreakpointPosition - previous.lastBreakpointPosition} positions past the previous one. Cache reads look back at most ${LOOKBACK_POSITIONS} positions, so the earlier cache entry was out of reach.`,
    });
  }
  if (causes.length === 0) {
    causes.push({
      kind: "unexplained",
      message: `The prefix, account, model, and parameters were unchanged, and ${formatDuration(gap)} passed since the previous request started, but upstream did not return the cached prefix (eviction or backend routing).`,
    });
  }
  return causes;
}

function promptChangeMessage(divergence: CacheMissDivergence): string {
  const segment =
    divergence.label === null
      ? divergence.path
      : `${divergence.path} (${divergence.label})`;
  const change =
    divergence.change === "modified"
      ? divergence.keyOrderOnly
        ? "was re-serialized with a different key order"
        : "was modified"
      : `was ${divergence.change}`;
  const scope =
    divergence.level === "tools"
      ? "A tools change invalidates the whole cache."
      : divergence.level === "system" || divergence.level === "instructions"
        ? "This invalidates the system prompt and all later content."
        : "This invalidates the cache from that block onward.";
  return `Prompt segment ${segment} ${change}. ${scope}`;
}

function parameterChanges(
  previous: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, string>,
): string[] {
  const names = [...new Set([...previous.keys(), ...current.keys()])].sort();
  return names.flatMap((name) => {
    const before = previous.get(name);
    const after = current.get(name);
    if (before === after) return [];
    const members = memberChanges(name, before, after);
    if (members !== null) return [members];
    const offset =
      before === undefined || after === undefined
        ? 0
        : firstDifference(before, after);
    return [
      `${name} ${shortValue(before, offset)} → ${shortValue(after, offset)}`,
    ];
  });
}

function memberChanges(
  name: string,
  before: string | undefined,
  after: string | undefined,
): string | null {
  const previous = before === undefined ? [] : parameterMembers(name, before);
  const current = after === undefined ? [] : parameterMembers(name, after);
  if (previous === null || current === null) return null;
  const removed = previous.filter((member) => !current.includes(member));
  const added = current.filter((member) => !previous.includes(member));
  const changes = [
    ...(removed.length === 0 ? [] : [`removed ${removed.join(", ")}`]),
    ...(added.length === 0 ? [] : [`added ${added.join(", ")}`]),
  ];
  return changes.length === 0 ? null : `${name} ${changes.join(" and ")}`;
}

function shortValue(value: string | undefined, offset: number): string {
  if (value === undefined) return "(absent)";
  if (value.length <= MAX_PARAM_VALUE_LENGTH) return value;
  const tailStart = value.length - (MAX_PARAM_VALUE_LENGTH - 1);
  const start = Math.min(Math.max(0, offset - PARAM_VALUE_CONTEXT), tailStart);
  if (start === 0) return `${value.slice(0, MAX_PARAM_VALUE_LENGTH - 1)}…`;
  if (start === tailStart) return `…${value.slice(start)}`;
  return `…${value.slice(start, start + MAX_PARAM_VALUE_LENGTH - 2)}…`;
}

function describeModel(model: string | null): string {
  return model ?? "an unspecified model";
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.ceil(Math.max(0, milliseconds) / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  return parts.length === 0 ? "0s" : parts.join(" ");
}
