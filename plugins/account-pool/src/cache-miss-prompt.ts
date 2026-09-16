import { hash } from "node:crypto";
import * as zlib from "node:zlib";
import { z } from "zod";
import type { CacheMissDivergence, PoolProvider } from "./contracts.js";
import {
  escapeEnd,
  escapeStart,
  firstDifference,
} from "./cache-miss-excerpt.js";

const MAX_DECODED_BODY_BYTES = 64 * 1024 * 1024;
const FIVE_MINUTES_MS = 300_000;
const THIRTY_MINUTES_MS = 1_800_000;
const ONE_HOUR_MS = 3_600_000;
const BILLING_HEADER_PREFIX = "x-anthropic-billing-header:";
const BETA_HEADER = "anthropic-beta";
const SUBAGENT_FLAG = /(?:^|[\s;])cc_is_subagent=true(?=$|[\s;])/u;
const CODEX_LITE_HEADER = "x-openai-internal-codex-responses-lite";
const CODEX_TURN_METADATA_HEADER = "x-codex-turn-metadata";
const CODEX_WINDOW_ID_HEADER = "x-codex-window-id";
const CLAUDE_PARAMS = [
  "thinking",
  "output_config",
  "context_management",
  "tool_choice",
  "speed",
] as const;
const CODEX_PARAMS = [
  "reasoning",
  "text",
  "tool_choice",
  "parallel_tool_calls",
  "service_tier",
  "prompt_cache_key",
] as const;
const EXCERPT_BEFORE = 120;
const EXCERPT_AFTER = 180;
const ELLIPSIS = "…";

export type PromptLevel = CacheMissDivergence["level"];
export type PromptRequestKind = "main" | "subagent" | "compaction";

export interface PromptSegment {
  level: PromptLevel;
  path: string;
  label: string | null;
  text: string;
  hash: string;
  position: number;
}

export type DiffSegment = Omit<PromptSegment, "position">;

export interface PromptShape {
  model: string | null;
  segments: PromptSegment[];
  params: ReadonlyMap<string, string>;
  lastBreakpointPosition: number | null;
  cacheTtlMs: number;
  requestKind: PromptRequestKind;
  subagentLineage: string | null;
  historyLength: number;
  windowNumber: number | null;
}

interface RawSegment {
  level: PromptLevel;
  path: string;
  label: string | null;
  value: unknown;
  run: "tool_use" | "tool_result" | null;
}

interface BreakpointScan {
  found: boolean;
  oneHour: boolean;
}

const claudeContentSchema = z.union([z.string(), z.array(z.unknown())]);

const claudeRequestSchema = z
  .object({
    model: z.string().nullish(),
    tools: z.array(z.unknown()).nullish(),
    system: claudeContentSchema.nullish(),
    messages: z.array(
      z
        .object({ role: z.unknown(), content: claudeContentSchema })
        .passthrough(),
    ),
    cache_control: z.unknown(),
  })
  .passthrough();

const codexRequestSchema = z
  .object({
    model: z.string().nullish(),
    tools: z.array(z.unknown()).nullish(),
    instructions: z.unknown(),
    input: z.union([z.string(), z.array(z.unknown())]).nullish(),
    client_metadata: z.unknown(),
  })
  .passthrough();

const codexTurnMetadataSchema = z
  .object({
    request_kind: z.string().nullish().catch(null),
    window_number: z.number().int().nonnegative().nullish().catch(null),
  })
  .passthrough();

export function decodeRequestBody(
  body: Uint8Array,
  contentEncoding: string | null,
): Uint8Array | null {
  const encoding = contentEncoding?.trim().toLowerCase() ?? "";
  if (encoding === "" || encoding === "identity") return body;
  const options = { maxOutputLength: MAX_DECODED_BODY_BYTES };
  try {
    switch (encoding) {
      case "zstd":
        return zlib.zstdDecompressSync(body, options);
      case "gzip":
      case "x-gzip":
        return zlib.gunzipSync(body, options);
      case "br":
        return zlib.brotliDecompressSync(body, options);
      case "deflate":
        return zlib.inflateSync(body, options);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function parsePrompt(
  provider: PoolProvider,
  body: Uint8Array,
  headers: Headers,
): PromptShape | null {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
  return provider === "claude"
    ? claudePrompt(json, headers)
    : codexPrompt(json, headers);
}

export function sharedPrefixLength(
  previous: readonly { hash: string }[],
  current: readonly { hash: string }[],
): number {
  const limit = Math.min(previous.length, current.length);
  let index = 0;
  while (index < limit && previous[index].hash === current[index].hash)
    index += 1;
  return index;
}

export function diffPrompts(
  previous: readonly DiffSegment[],
  current: readonly DiffSegment[],
): CacheMissDivergence | null {
  const shared = sharedPrefixLength(previous, current);
  if (shared === previous.length) return null;
  const counts = {
    sharedSegments: shared,
    previousSegments: previous.length,
    currentSegments: current.length,
  };
  const before = previous[shared];
  if (shared === current.length) return removed(before, counts);
  const after = current[shared];
  if (current[shared + 1]?.hash === before.hash) {
    return {
      level: after.level,
      path: after.path,
      label: after.label,
      change: "inserted",
      offset: null,
      before: null,
      after: excerpt(after.text, 0),
      keyOrderOnly: false,
      ...counts,
    };
  }
  if (previous[shared + 1]?.hash === after.hash) return removed(before, counts);
  const texts = excerptTexts(before.text, after.text);
  const offset = firstDifference(texts.before, texts.after);
  const previousCanonical = canonicalText(before.text);
  return {
    level: after.level,
    path: after.path,
    label: after.label,
    change: "modified",
    offset,
    before: excerpt(texts.before, offset),
    after: excerpt(texts.after, offset),
    keyOrderOnly:
      previousCanonical !== null &&
      previousCanonical === canonicalText(after.text),
    ...counts,
  };
}

function excerptTexts(
  before: string,
  after: string,
): { before: string; after: string } {
  const previous = withoutTopLevelId(before);
  const current = withoutTopLevelId(after);
  if (previous === null || current === null || previous === current)
    return { before, after };
  return { before: previous, after: current };
}

function withoutTopLevelId(text: string): string | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || !Object.hasOwn(value, "id")) return null;
  return JSON.stringify(withoutId(value));
}

function withoutId(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "id"),
  );
}

function canonicalText(text: string): string | null {
  try {
    return canonicalJson(JSON.parse(text));
  } catch {
    return null;
  }
}

function removed(
  segment: DiffSegment,
  counts: Pick<
    CacheMissDivergence,
    "sharedSegments" | "previousSegments" | "currentSegments"
  >,
): CacheMissDivergence {
  return {
    level: segment.level,
    path: segment.path,
    label: segment.label,
    change: "removed",
    offset: null,
    before: excerpt(segment.text, 0),
    after: null,
    keyOrderOnly: false,
    ...counts,
  };
}

function excerpt(text: string, offset: number): string {
  let start = Math.max(0, offset - EXCERPT_BEFORE);
  let end = Math.min(text.length, offset + EXCERPT_AFTER);
  if (start > 0 && isLowSurrogate(text.charCodeAt(start))) start += 1;
  if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end -= 1;
  start = escapeEnd(text, start);
  end = escapeStart(text, end);
  return detached(
    `${start > 0 ? ELLIPSIS : ""}${text.slice(start, end)}${end < text.length ? ELLIPSIS : ""}`,
  );
}

function detached(text: string): string {
  return Buffer.from(text, "utf8").toString("utf8");
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function claudePrompt(json: unknown, headers: Headers): PromptShape | null {
  const parsed = claudeRequestSchema.safeParse(json);
  if (!parsed.success) return null;
  const request = parsed.data;
  const scan: BreakpointScan = { found: false, oneHour: false };
  const params = new Map<string, string>();
  for (const name of CLAUDE_PARAMS) {
    if (request[name] !== undefined)
      params.set(name, canonicalJson(request[name]));
  }
  const automaticBreakpoint = isRecord(request.cache_control);
  if (isRecord(request.cache_control)) {
    const ttl =
      typeof request.cache_control.ttl === "string"
        ? request.cache_control.ttl
        : "5m";
    params.set("cache_control.ttl", JSON.stringify(ttl));
    if (ttl === "1h") scan.oneHour = true;
  }
  const betas = headers.get(BETA_HEADER);
  if (betas !== null) params.set(BETA_HEADER, normalizeBetas(betas));
  let requestKind: PromptRequestKind = "main";
  const raw: RawSegment[] = [];
  for (const [index, tool] of (request.tools ?? []).entries()) {
    raw.push({
      level: "tools",
      path: `tools[${index}]`,
      label: toolLabel(tool),
      value: tool,
      run: null,
    });
  }
  const system =
    typeof request.system === "string"
      ? [{ type: "text", text: request.system }]
      : (request.system ?? []);
  for (const [index, block] of system.entries()) {
    if (
      isRecord(block) &&
      typeof block.text === "string" &&
      block.text.startsWith(BILLING_HEADER_PREFIX)
    ) {
      if (SUBAGENT_FLAG.test(block.text)) requestKind = "subagent";
      normalizeValue(block, scan);
      continue;
    }
    raw.push({
      level: "system",
      path: `system[${index}]`,
      label: "system",
      value: block,
      run: null,
    });
  }
  const messagesStart = raw.length;
  let lineageLength = messagesStart;
  for (const [messageIndex, message] of request.messages.entries()) {
    const role = typeof message.role === "string" ? message.role : null;
    const content =
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : message.content;
    for (const [blockIndex, block] of content.entries()) {
      const type =
        isRecord(block) && typeof block.type === "string" ? block.type : null;
      const name =
        type === "tool_use" && isRecord(block) && typeof block.name === "string"
          ? block.name
          : null;
      raw.push({
        level: "messages",
        path: `messages[${messageIndex}].content[${blockIndex}]`,
        label: joinLabel([role, type, name]),
        value: block,
        run: type === "tool_use" || type === "tool_result" ? type : null,
      });
    }
    if (messageIndex === 0) lineageLength = raw.length;
  }
  const built = buildSegments(raw, scan);
  const lastSegment = built.segments.at(-1);
  return {
    model: request.model ?? null,
    segments: built.segments,
    params,
    lastBreakpointPosition:
      automaticBreakpoint && lastSegment !== undefined
        ? lastSegment.position
        : built.lastBreakpointPosition,
    cacheTtlMs: scan.oneHour ? ONE_HOUR_MS : FIVE_MINUTES_MS,
    requestKind,
    subagentLineage:
      requestKind === "subagent"
        ? sha256(
            built.segments
              .slice(messagesStart, lineageLength)
              .map((segment) => segment.hash)
              .join(","),
          )
        : null,
    historyLength: request.messages.filter(
      (message) => message.role === "assistant",
    ).length,
    windowNumber: null,
  };
}

function codexPrompt(json: unknown, headers: Headers): PromptShape | null {
  const parsed = codexRequestSchema.safeParse(json);
  if (!parsed.success) return null;
  const request = parsed.data;
  const params = new Map<string, string>();
  for (const name of CODEX_PARAMS) {
    if (request[name] !== undefined)
      params.set(name, canonicalJson(request[name]));
  }
  const lite = headers.get(CODEX_LITE_HEADER);
  if (lite !== null) params.set(CODEX_LITE_HEADER, JSON.stringify(lite));
  const raw: RawSegment[] = [];
  for (const [index, tool] of (request.tools ?? []).entries()) {
    raw.push({
      level: "tools",
      path: `tools[${index}]`,
      label: toolLabel(tool),
      value: tool,
      run: null,
    });
  }
  if (request.instructions !== undefined && request.instructions !== null) {
    raw.push({
      level: "instructions",
      path: "instructions",
      label: "instructions",
      value: request.instructions,
      run: null,
    });
  }
  const input =
    typeof request.input === "string"
      ? [{ type: "message", role: "user", content: request.input }]
      : (request.input ?? []);
  const threadScoped = threadScopedPrefixLength(input);
  for (const [index, item] of input.entries()) {
    raw.push({
      level: "input",
      path: `input[${index}]`,
      label: codexItemLabel(item),
      value: index < threadScoped && isRecord(item) ? withoutId(item) : item,
      run: null,
    });
  }
  const client = isRecord(request.client_metadata)
    ? request.client_metadata
    : null;
  const metadata =
    parseTurnMetadata(headers.get(CODEX_TURN_METADATA_HEADER)) ??
    parseTurnMetadata(client?.[CODEX_TURN_METADATA_HEADER]);
  const windowId =
    headers.get(CODEX_WINDOW_ID_HEADER) ?? client?.[CODEX_WINDOW_ID_HEADER];
  return {
    model: request.model ?? null,
    segments: buildSegments(raw, null).segments,
    params,
    lastBreakpointPosition: null,
    cacheTtlMs: THIRTY_MINUTES_MS,
    requestKind:
      metadata?.request_kind === "compaction" ? "compaction" : "main",
    subagentLineage: null,
    historyLength: input.length,
    windowNumber: metadata?.window_number ?? windowNumberFromId(windowId),
  };
}

function buildSegments(
  raw: readonly RawSegment[],
  scan: BreakpointScan | null,
): { segments: PromptSegment[]; lastBreakpointPosition: number | null } {
  const segments: PromptSegment[] = [];
  let position = -1;
  let previousRun: RawSegment["run"] = null;
  let lastBreakpointPosition: number | null = null;
  for (const segment of raw) {
    if (scan !== null) scan.found = false;
    normalizeValue(segment.value, scan);
    if (segment.run === null || segment.run !== previousRun) position += 1;
    previousRun = segment.run;
    if (scan?.found === true) lastBreakpointPosition = position;
    const text = JSON.stringify(segment.value);
    segments.push({
      level: segment.level,
      path: segment.path,
      label: segment.label,
      text,
      hash: sha256(text),
      position,
    });
  }
  return { segments, lastBreakpointPosition };
}

function normalizeValue(value: unknown, scan: BreakpointScan | null): void {
  if (Array.isArray(value)) {
    for (const item of value) normalizeValue(item, scan);
    return;
  }
  if (!isRecord(value)) return;
  if (scan !== null && Object.hasOwn(value, "cache_control")) {
    const cacheControl = value.cache_control;
    if (isRecord(cacheControl)) {
      scan.found = true;
      if (cacheControl.ttl === "1h") scan.oneHour = true;
    }
    delete value.cache_control;
  }
  for (const key of Object.keys(value)) normalizeValue(value[key], scan);
  const source = value.source;
  if (isRecord(source) && typeof source.data === "string")
    source.data = opaqueMarker(source.data);
  if (typeof value.signature === "string")
    value.signature = opaqueMarker(value.signature);
  if (value.type === "redacted_thinking" && typeof value.data === "string")
    value.data = opaqueMarker(value.data);
  if (typeof value.encrypted_content === "string")
    value.encrypted_content = opaqueMarker(value.encrypted_content);
  if (
    typeof value.image_url === "string" &&
    value.image_url.startsWith("data:")
  )
    value.image_url = opaqueMarker(value.image_url);
  if (
    typeof value.audio_url === "string" &&
    value.audio_url.startsWith("data:")
  )
    value.audio_url = opaqueMarker(value.audio_url);
  if (typeof value.file_data === "string")
    value.file_data = opaqueMarker(value.file_data);
  if (
    value.type === "image_generation_call" &&
    typeof value.result === "string"
  )
    value.result = opaqueMarker(value.result);
}

function opaqueMarker(value: string): string {
  return `sha256:${sha256(value).slice(0, 16)}${ELLIPSIS}(${Buffer.byteLength(value, "utf8")} bytes)`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(text: string): string {
  return hash("sha256", text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBetas(value: string): string {
  const betas = new Set(
    value
      .split(",")
      .map((beta) => beta.trim())
      .filter((beta) => beta.length > 0),
  );
  return [...betas].sort().join(",");
}

export function parameterMembers(name: string, value: string): string[] | null {
  if (name !== BETA_HEADER) return null;
  return value === "" ? [] : value.split(",");
}

function threadScopedPrefixLength(input: readonly unknown[]): number {
  const [tools, instructions] = input;
  if (!isRecord(tools) || tools.type !== "additional_tools") return 0;
  return isRecord(instructions) &&
    instructions.type === "message" &&
    instructions.role === "developer"
    ? 2
    : 1;
}

function joinLabel(parts: ReadonlyArray<string | null>): string | null {
  const present = parts.filter((part): part is string => part !== null);
  return present.length === 0 ? null : present.join(" ");
}

function toolLabel(tool: unknown): string {
  if (!isRecord(tool)) return "tool";
  const name =
    typeof tool.name === "string"
      ? tool.name
      : typeof tool.type === "string"
        ? tool.type
        : null;
  return name === null ? "tool" : `tool ${name}`;
}

function codexItemLabel(item: unknown): string | null {
  if (!isRecord(item)) return null;
  if (item.type === "additional_tools") return "additional tools";
  return joinLabel([
    typeof item.type === "string" ? item.type : null,
    typeof item.role === "string" ? item.role : null,
    typeof item.name === "string" ? item.name : null,
  ]);
}

function parseTurnMetadata(
  value: unknown,
): z.infer<typeof codexTurnMetadataSchema> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = codexTurnMetadataSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function windowNumberFromId(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /:(\d+)$/u.exec(value);
  if (match === null) return null;
  const windowNumber = Number(match[1]);
  return Number.isSafeInteger(windowNumber) ? windowNumber : null;
}
