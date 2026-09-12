import type { EmissionLogEvent } from "./emission-log.js";

export function percentile(
  values: readonly number[],
  p: number,
): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = (p / 100) * (sorted.length - 1);
  const lower = sorted[Math.floor(rank)] ?? 0;
  const upper = sorted[Math.ceil(rank)] ?? 0;
  return lower + (upper - lower) * (rank - Math.floor(rank));
}

function maxOrNull(values: readonly number[]): number | null {
  let max: number | null = null;
  for (const value of values) {
    if (max === null || value > max) {
      max = value;
    }
  }
  return max;
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

export type FrameSummary = {
  count: number;
  durationMs: number;
  p50IntervalMs: number | null;
  p95IntervalMs: number | null;
  maxIntervalMs: number | null;
  framesOver25Ms: number;
  framesOver50Ms: number;
};

export function summarizeFrames(frames: readonly number[]): FrameSummary {
  const intervals: number[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    const current = frames[index];
    const previous = frames[index - 1];
    if (current !== undefined && previous !== undefined) {
      intervals.push(current - previous);
    }
  }
  const first = frames[0];
  const last = frames.at(-1);
  return {
    count: frames.length,
    durationMs: first === undefined || last === undefined ? 0 : last - first,
    p50IntervalMs: percentile(intervals, 50),
    p95IntervalMs: percentile(intervals, 95),
    maxIntervalMs: maxOrNull(intervals),
    framesOver25Ms: intervals.filter((interval) => interval > 25).length,
    framesOver50Ms: intervals.filter((interval) => interval > 50).length,
  };
}

export type LoafScriptInput = {
  duration: number;
  invoker: string;
  sourceURL: string;
  sourceFunctionName: string;
  forcedStyleAndLayoutDuration: number;
};

export type LoafInput = {
  duration: number;
  blockingDuration: number;
  scripts: readonly LoafScriptInput[];
};

export type LoafScriptSummary = {
  sourceURL: string;
  functionName: string;
  invoker: string;
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
  forcedStyleAndLayoutMs: number;
};

export type LoafSummary = {
  count: number;
  totalDurationMs: number;
  totalBlockingDurationMs: number;
  maxDurationMs: number | null;
  topScripts: LoafScriptSummary[];
};

export function summarizeLoafs(
  loafs: readonly LoafInput[],
  top: number,
): LoafSummary {
  const scripts = new Map<string, LoafScriptSummary>();
  for (const loaf of loafs) {
    for (const script of loaf.scripts) {
      const functionName =
        script.sourceFunctionName === ""
          ? "(anonymous)"
          : script.sourceFunctionName;
      const key = JSON.stringify([script.sourceURL, functionName]);
      const existing = scripts.get(key);
      if (existing === undefined) {
        scripts.set(key, {
          sourceURL: script.sourceURL,
          functionName,
          invoker: script.invoker,
          count: 1,
          totalDurationMs: script.duration,
          maxDurationMs: script.duration,
          forcedStyleAndLayoutMs: script.forcedStyleAndLayoutDuration,
        });
        continue;
      }
      existing.count += 1;
      existing.totalDurationMs += script.duration;
      existing.forcedStyleAndLayoutMs += script.forcedStyleAndLayoutDuration;
      if (script.duration > existing.maxDurationMs) {
        existing.maxDurationMs = script.duration;
        existing.invoker = script.invoker;
      }
    }
  }
  const topScripts = [...scripts.values()]
    .sort(
      (left, right) =>
        right.totalDurationMs - left.totalDurationMs ||
        left.sourceURL.localeCompare(right.sourceURL) ||
        left.functionName.localeCompare(right.functionName),
    )
    .slice(0, top);
  return {
    count: loafs.length,
    totalDurationMs: sum(loafs.map((loaf) => loaf.duration)),
    totalBlockingDurationMs: sum(loafs.map((loaf) => loaf.blockingDuration)),
    maxDurationMs: maxOrNull(loafs.map((loaf) => loaf.duration)),
    topScripts,
  };
}

export type LongTaskInput = readonly [startTime: number, duration: number];

export type LongTaskSummary = {
  count: number;
  totalMs: number;
  maxMs: number | null;
  totalBlockingTimeMs: number;
};

export function summarizeLongTasks(
  tasks: readonly LongTaskInput[],
): LongTaskSummary {
  const durations = tasks.map(([, duration]) => duration);
  return {
    count: tasks.length,
    totalMs: sum(durations),
    maxMs: maxOrNull(durations),
    totalBlockingTimeMs: sum(
      durations.map((duration) => Math.max(0, duration - 50)),
    ),
  };
}

export type PerformanceMetricsDelta = {
  taskDurationMs: number;
  scriptDurationMs: number;
  layoutDurationMs: number;
  recalcStyleDurationMs: number;
  layoutCount: number;
  recalcStyleCount: number;
  jsHeapUsedSizeBytes: number;
};

function metricDelta(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
  name: string,
): number {
  const start = before[name];
  const end = after[name];
  if (start === undefined || end === undefined) {
    throw new Error(
      `Performance metric ${name} is missing from the ${start === undefined ? "before" : "after"} snapshot`,
    );
  }
  return end - start;
}

export function diffPerformanceMetrics(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): PerformanceMetricsDelta {
  return {
    taskDurationMs: metricDelta(before, after, "TaskDuration") * 1000,
    scriptDurationMs: metricDelta(before, after, "ScriptDuration") * 1000,
    layoutDurationMs: metricDelta(before, after, "LayoutDuration") * 1000,
    recalcStyleDurationMs:
      metricDelta(before, after, "RecalcStyleDuration") * 1000,
    layoutCount: metricDelta(before, after, "LayoutCount"),
    recalcStyleCount: metricDelta(before, after, "RecalcStyleCount"),
    jsHeapUsedSizeBytes: metricDelta(before, after, "JSHeapUsedSize"),
  };
}

export function nthOccurrence(
  text: string,
  phrase: string,
  occurrence: number,
): number {
  let from = 0;
  let index = -1;
  for (let found = 0; found < occurrence; found += 1) {
    index = text.indexOf(phrase, from);
    if (index === -1) {
      return -1;
    }
    from = index + phrase.length;
  }
  return index;
}

const MAX_CHECKPOINTS_BEFORE_THINNING = 40;
const MIN_PHRASE_WORDS = 6;
const MAX_PHRASE_WORDS = 10;
const MIN_PHRASE_CHARS = 20;
const MARKDOWN_SYNTAX_CHARS = /[*_[\]()<>#|$\\`~&]/g;
const LEADING_WHITESPACE = /^\s/;
const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
const THEMATIC_BREAK =
  /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+(\S.*)$/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const BLOCKQUOTE = /^ {0,3}>/;
const DISPLAY_MATH = /^\s*\$\$/;
const RENDER_REMOVED = new RegExp(
  [
    String.raw`\]\((?:<[^>\n]*>|[^\s()]*)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*\)`,
    String.raw`\]\[[^\]\n]*\]`,
    String.raw`<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>\n]*)?\/?>`,
    String.raw`[*_~\x60\\[\]()<>$]`,
  ].join("|"),
  "g",
);
const WORD = /\S+/g;

type SourceLine = { text: string; start: number };
type LineKind = "blank" | "boundary" | "list" | "text";
type CheckpointCandidate = { phrase: string; start: number };
type OpenBlock = { kind: "fence"; close: RegExp } | { kind: "math" };
type RenderedPiece = { sourceStart: number; textStart: number; length: number };
type RenderApproximation = { text: string; pieces: RenderedPiece[] };

function splitSourceLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (;;) {
    const end = text.indexOf("\n", start);
    const raw = end === -1 ? text.slice(start) : text.slice(start, end);
    lines.push({ text: raw.endsWith("\r") ? raw.slice(0, -1) : raw, start });
    if (end === -1) {
      return lines;
    }
    start = end + 1;
  }
}

function classifyLine(line: string): LineKind {
  if (line.trim() === "") {
    return "blank";
  }
  if (
    THEMATIC_BREAK.test(line) ||
    HEADING.test(line) ||
    BLOCKQUOTE.test(line) ||
    FENCE_OPEN.test(line) ||
    DISPLAY_MATH.test(line)
  ) {
    return "boundary";
  }
  if (LIST_ITEM.test(line)) {
    return "list";
  }
  return "text";
}

function listItemContent(line: string): string {
  let content = line;
  for (;;) {
    const match = LIST_ITEM.exec(content);
    if (match?.[1] === undefined) {
      return content;
    }
    content = match[1];
  }
}

function endsParagraph(next: SourceLine | undefined): boolean {
  return next === undefined || classifyLine(next.text) !== "text";
}

function blockOpenedBy(
  content: string,
): { block: OpenBlock; closedOnSameLine: boolean } | null {
  const fence = FENCE_OPEN.exec(content);
  if (fence?.[1] !== undefined) {
    const marker = fence[1];
    const markerChar = marker[0] === "`" ? "`" : "~";
    return {
      block: {
        kind: "fence",
        close: new RegExp(`^\\s*${markerChar}{${marker.length},}[ \\t]*$`),
      },
      closedOnSameLine: false,
    };
  }
  if (DISPLAY_MATH.test(content)) {
    return {
      block: { kind: "math" },
      closedOnSameLine: content.trim().slice(2).endsWith("$$"),
    };
  }
  return null;
}

function blockClosedBy(block: OpenBlock, line: string): boolean {
  switch (block.kind) {
    case "fence":
      return block.close.test(line);
    case "math":
      return line.trimEnd().endsWith("$$");
  }
}

function phraseCandidate(
  content: string,
  contentStart: number,
): CheckpointCandidate | null {
  const trimmed = content.trimEnd();
  let tailStart = 0;
  for (const match of trimmed.matchAll(MARKDOWN_SYNTAX_CHARS)) {
    tailStart = match.index + match[0].length;
  }
  const tail = trimmed.slice(tailStart);
  const tailWords = [...tail.matchAll(WORD)];
  const words =
    tailStart > 0 && !LEADING_WHITESPACE.test(tail)
      ? tailWords.slice(1)
      : tailWords;
  if (words.length < MIN_PHRASE_WORDS) {
    return null;
  }
  const firstWord = words[Math.max(0, words.length - MAX_PHRASE_WORDS)];
  if (firstWord?.index === undefined) {
    return null;
  }
  const phraseStart = tailStart + firstWord.index;
  const phrase = trimmed.slice(phraseStart);
  if (phrase.length < MIN_PHRASE_CHARS) {
    return null;
  }
  return { phrase, start: contentStart + phraseStart };
}

function collectCheckpointCandidates(
  fixtureText: string,
): CheckpointCandidate[] {
  const lines = splitSourceLines(fixtureText);
  const candidates: CheckpointCandidate[] = [];
  let open: OpenBlock | null = null;
  for (const [index, line] of lines.entries()) {
    if (open !== null) {
      if (blockClosedBy(open, line.text)) {
        open = null;
      }
      continue;
    }
    const kind = classifyLine(line.text);
    if (kind === "blank") {
      continue;
    }
    const content =
      kind === "list" ? listItemContent(line.text) : line.text.trimStart();
    const opened = blockOpenedBy(content);
    if (opened !== null) {
      if (!opened.closedOnSameLine) {
        open = opened.block;
      }
      continue;
    }
    if (kind === "boundary") {
      continue;
    }
    if (!endsParagraph(lines[index + 1])) {
      continue;
    }
    const contentStart = line.start + line.text.length - content.length;
    const candidate = phraseCandidate(content, contentStart);
    if (candidate !== null) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

function approximateRenderedText(source: string): RenderApproximation {
  const parts: string[] = [];
  const pieces: RenderedPiece[] = [];
  let sourceIndex = 0;
  let textLength = 0;
  const keepUntil = (end: number) => {
    if (end <= sourceIndex) {
      return;
    }
    pieces.push({
      sourceStart: sourceIndex,
      textStart: textLength,
      length: end - sourceIndex,
    });
    parts.push(source.slice(sourceIndex, end));
    textLength += end - sourceIndex;
  };
  for (const match of source.matchAll(RENDER_REMOVED)) {
    keepUntil(match.index);
    sourceIndex = match.index + match[0].length;
  }
  keepUntil(source.length);
  return { text: parts.join(""), pieces };
}

function renderedIndexOf(
  approximation: RenderApproximation,
  sourceIndex: number,
): number | null {
  let low = 0;
  let high = approximation.pieces.length - 1;
  let found: RenderedPiece | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const piece = approximation.pieces[middle];
    if (piece === undefined) {
      return null;
    }
    if (piece.sourceStart <= sourceIndex) {
      found = piece;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (found === null || sourceIndex - found.sourceStart >= found.length) {
    return null;
  }
  return found.textStart + (sourceIndex - found.sourceStart);
}

export function selectCheckpoints(fixtureText: string): string[] {
  const candidates = collectCheckpointCandidates(fixtureText);
  const every = Math.max(
    1,
    Math.ceil(candidates.length / MAX_CHECKPOINTS_BEFORE_THINNING),
  );
  const uniqueIndexByPhrase = new Map<string, number>();
  for (const candidate of candidates) {
    if (!uniqueIndexByPhrase.has(candidate.phrase)) {
      uniqueIndexByPhrase.set(candidate.phrase, uniqueIndexByPhrase.size);
    }
  }
  const rendered = approximateRenderedText(fixtureText);
  const listed = new Map<string, number>();
  const phrases: string[] = [];
  for (const candidate of candidates) {
    const uniqueIndex = uniqueIndexByPhrase.get(candidate.phrase);
    if (
      uniqueIndex === undefined ||
      (uniqueIndexByPhrase.size - 1 - uniqueIndex) % every !== 0
    ) {
      continue;
    }
    const occurrence = (listed.get(candidate.phrase) ?? 0) + 1;
    if (
      nthOccurrence(fixtureText, candidate.phrase, occurrence) !==
      candidate.start
    ) {
      continue;
    }
    const renderedStart = renderedIndexOf(rendered, candidate.start);
    if (
      renderedStart === null ||
      nthOccurrence(rendered.text, candidate.phrase, occurrence) !==
        renderedStart
    ) {
      continue;
    }
    listed.set(candidate.phrase, occurrence);
    phrases.push(candidate.phrase);
  }
  return phrases;
}

export type CheckpointLatency = {
  index: number;
  phrase: string;
  sourceEndOffset: number;
  emissionOffset: number;
  emittedAtEpochMs: number | null;
  hitAtEpochMs: number | null;
  latencyMs: number | null;
};

export type CheckpointLatencySummary = {
  checkpoints: CheckpointLatency[];
  hitCount: number;
  missedCount: number;
  negativeLatencyCount: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  maxLatencyMs: number | null;
};

type EmissionDelta = Extract<EmissionLogEvent, { event: "delta" }>;

function firstDeltaReaching(
  deltas: readonly EmissionDelta[],
  offset: number,
): EmissionDelta | null {
  let low = 0;
  let high = deltas.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const delta = deltas[middle];
    if (delta !== undefined && delta.chars >= offset) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return deltas[low] ?? null;
}

export function checkpointLatencies(args: {
  fixtureText: string;
  checkpoints: readonly string[];
  emissionLog: readonly EmissionLogEvent[];
  hits: readonly number[];
}): CheckpointLatencySummary {
  const completedAt =
    args.emissionLog.find((event) => event.event === "complete")?.t ?? null;
  const startEvents = args.emissionLog.filter(
    (event) => event.event === "start",
  );
  if (startEvents.length > 1) {
    throw new Error(
      `checkpointLatencies expects one emission run, received ${startEvents.length} start events`,
    );
  }
  const deltas = args.emissionLog.filter(
    (event): event is EmissionDelta => event.event === "delta",
  );
  const listed = new Map<string, number>();
  const rows = args.checkpoints.map((phrase, index): CheckpointLatency => {
    const occurrence = (listed.get(phrase) ?? 0) + 1;
    listed.set(phrase, occurrence);
    const start = nthOccurrence(args.fixtureText, phrase, occurrence);
    if (start === -1) {
      throw new Error(
        `Checkpoint ${index} ${JSON.stringify(phrase)} (occurrence ${occurrence}) does not appear in the fixture text`,
      );
    }
    const sourceEndOffset = start + phrase.length;
    const newlineIndex = args.fixtureText.indexOf("\n", sourceEndOffset);
    const emissionOffset =
      newlineIndex === -1 ? args.fixtureText.length : newlineIndex + 1;
    const emittedAtEpochMs =
      newlineIndex === -1
        ? completedAt
        : (firstDeltaReaching(deltas, emissionOffset)?.t ?? null);
    const hitAtEpochMs = args.hits[index] ?? null;
    return {
      emissionOffset,
      index,
      phrase,
      sourceEndOffset,
      emittedAtEpochMs,
      hitAtEpochMs,
      latencyMs:
        emittedAtEpochMs === null || hitAtEpochMs === null
          ? null
          : hitAtEpochMs - emittedAtEpochMs,
    };
  });
  const measured = rows.flatMap((row) =>
    row.latencyMs === null ? [] : [row.latencyMs],
  );
  const latencies = measured.filter((latency) => latency >= 0);
  const hitCount = rows.filter((row) => row.hitAtEpochMs !== null).length;
  return {
    checkpoints: rows,
    hitCount,
    missedCount: rows.length - hitCount,
    negativeLatencyCount: measured.length - latencies.length,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    maxLatencyMs: maxOrNull(latencies),
  };
}

export type NetworkRequestInput = {
  url: string;
  method: string;
  outcome: "pending" | "finished" | "failed";
  encodedDataLength: number | null;
  durationMs: number | null;
};

export type NetworkCaptureInput = {
  requests: readonly NetworkRequestInput[];
  webSocketFramesReceived: number;
  webSocketBytesReceived: number;
};

export type RequestGroupSummary = {
  count: number;
  finishedCount: number;
  failedCount: number;
  bytes: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
};

export type ApiRequestGroupSummary = RequestGroupSummary & {
  method: string;
  pathTemplate: string;
};

export type NetworkSummary = {
  timeline: {
    total: RequestGroupSummary;
    afterSequence: RequestGroupSummary;
    full: RequestGroupSummary;
    olderPage: RequestGroupSummary;
  };
  otherApi: ApiRequestGroupSummary[];
  webSocket: { framesReceived: number; bytesReceived: number };
};

const GENERATED_ID_SEGMENT = /^[a-z]+_[23456789abcdefghijkmnpqrstuvwxyz]{10}$/;
const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT = /^\d+$/;

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function apiPathTemplate(pathname: string, threadId: string): string {
  return pathname
    .split("/")
    .map((segment) => {
      const decoded = decodeSegment(segment);
      if (decoded === "") {
        return segment;
      }
      if (decoded === threadId) {
        return ":threadId";
      }
      if (UUID_SEGMENT.test(decoded)) {
        return ":uuid";
      }
      if (GENERATED_ID_SEGMENT.test(decoded)) {
        return ":id";
      }
      if (NUMERIC_SEGMENT.test(decoded)) {
        return ":n";
      }
      return segment;
    })
    .join("/");
}

function summarizeRequestGroup(
  requests: readonly NetworkRequestInput[],
): RequestGroupSummary {
  const finished = requests.filter((request) => request.outcome === "finished");
  const durations = finished.flatMap((request) =>
    request.durationMs === null ? [] : [request.durationMs],
  );
  return {
    count: requests.length,
    finishedCount: finished.length,
    failedCount: requests.filter((request) => request.outcome === "failed")
      .length,
    bytes: sum(finished.map((request) => request.encodedDataLength ?? 0)),
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    maxMs: maxOrNull(durations),
  };
}

export function summarizeNetwork(
  capture: NetworkCaptureInput,
  threadId: string,
): NetworkSummary {
  const timelinePath = `/api/v1/threads/${encodeURIComponent(threadId)}/timeline`;
  const afterSequence: NetworkRequestInput[] = [];
  const full: NetworkRequestInput[] = [];
  const olderPage: NetworkRequestInput[] = [];
  const otherGroups = new Map<
    string,
    { method: string; pathTemplate: string; requests: NetworkRequestInput[] }
  >();
  for (const request of capture.requests) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === timelinePath) {
      if (
        url.searchParams.has("beforeAnchorSeq") ||
        url.searchParams.has("beforeAnchorId")
      ) {
        olderPage.push(request);
      } else if (url.searchParams.has("afterSequence")) {
        afterSequence.push(request);
      } else {
        full.push(request);
      }
      continue;
    }
    const pathTemplate = apiPathTemplate(url.pathname, threadId);
    const key = `${request.method} ${pathTemplate}`;
    const group = otherGroups.get(key);
    if (group === undefined) {
      otherGroups.set(key, {
        method: request.method,
        pathTemplate,
        requests: [request],
      });
    } else {
      group.requests.push(request);
    }
  }
  const otherApi = [...otherGroups.values()]
    .map((group) => ({
      method: group.method,
      pathTemplate: group.pathTemplate,
      ...summarizeRequestGroup(group.requests),
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.pathTemplate.localeCompare(right.pathTemplate) ||
        left.method.localeCompare(right.method),
    );
  return {
    timeline: {
      total: summarizeRequestGroup([...afterSequence, ...full, ...olderPage]),
      afterSequence: summarizeRequestGroup(afterSequence),
      full: summarizeRequestGroup(full),
      olderPage: summarizeRequestGroup(olderPage),
    },
    otherApi,
    webSocket: {
      framesReceived: capture.webSocketFramesReceived,
      bytesReceived: capture.webSocketBytesReceived,
    },
  };
}

export type CpuProfileInput = {
  nodes: readonly {
    id: number;
    callFrame: {
      functionName: string;
      url: string;
      lineNumber: number;
      columnNumber: number;
    };
  }[];
  startTime: number;
  endTime: number;
  samples: readonly number[];
  timeDeltas: readonly number[];
};

export type CpuFunctionSelfTime = {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
  selfMs: number;
};

export type CpuProfileSummary = {
  durationMs: number;
  sampleCount: number;
  idleMs: number;
  programMs: number;
  garbageCollectorMs: number;
  top: CpuFunctionSelfTime[];
};

const SPECIAL_PROFILE_NODES = new Set([
  "(root)",
  "(idle)",
  "(program)",
  "(garbage collector)",
]);

function sampleSelfTimesUs(profile: CpuProfileInput): Map<number, number> {
  const selfTimes = new Map<number, number>();
  let timestamp = profile.startTime;
  const timestamps = profile.timeDeltas.map((delta) => {
    timestamp += delta;
    return timestamp;
  });
  for (const [index, nodeId] of profile.samples.entries()) {
    const current = timestamps[index] ?? profile.endTime;
    const next = timestamps[index + 1] ?? profile.endTime;
    selfTimes.set(
      nodeId,
      (selfTimes.get(nodeId) ?? 0) + Math.max(0, next - current),
    );
  }
  return selfTimes;
}

export function summarizeCpuProfile(
  profile: CpuProfileInput,
  top: number,
): CpuProfileSummary {
  const selfTimes = sampleSelfTimesUs(profile);
  const special = new Map<string, number>();
  const functions = new Map<string, CpuFunctionSelfTime>();
  for (const node of profile.nodes) {
    const selfUs = selfTimes.get(node.id) ?? 0;
    const { functionName, url, lineNumber, columnNumber } = node.callFrame;
    if (SPECIAL_PROFILE_NODES.has(functionName)) {
      special.set(functionName, (special.get(functionName) ?? 0) + selfUs);
      continue;
    }
    const name = functionName === "" ? "(anonymous)" : functionName;
    const key = JSON.stringify([url, lineNumber, columnNumber, name]);
    const existing = functions.get(key);
    if (existing === undefined) {
      functions.set(key, {
        functionName: name,
        url,
        lineNumber,
        columnNumber,
        selfMs: selfUs / 1000,
      });
    } else {
      existing.selfMs += selfUs / 1000;
    }
  }
  return {
    durationMs: (profile.endTime - profile.startTime) / 1000,
    sampleCount: profile.samples.length,
    idleMs: (special.get("(idle)") ?? 0) / 1000,
    programMs: (special.get("(program)") ?? 0) / 1000,
    garbageCollectorMs: (special.get("(garbage collector)") ?? 0) / 1000,
    top: [...functions.values()]
      .filter((entry) => entry.selfMs > 0)
      .sort(
        (left, right) =>
          right.selfMs - left.selfMs || left.url.localeCompare(right.url),
      )
      .slice(0, top),
  };
}
