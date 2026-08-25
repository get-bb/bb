/**
 * ACP tool call → grammar v3 item shape + presentation.
 *
 * An ACP agent describes a tool call with a native kind enum and a human
 * title. The kind maps straight onto the core kinds: `execute` → `command`,
 * `edit`/`delete` → `fileChange`, `read` → `fileRead`, `search` → `search`,
 * `fetch` → `webFetch`, `think` → `reasoning`; everything else — `other`,
 * `move`, an agent that sent no kind — is a generic `tool` whose `tool` slot
 * names the kind. The title is never a tool name: it rides
 * `presentation.title`.
 *
 * A core shape has required fields the agent does not always fill (Cursor's
 * `read` and `fetch` calls carry an empty `rawInput` and no `locations`). A
 * kind whose shape cannot be built honestly stays a generic `tool` that
 * presents as its kind ("Reading file" with the agent's title), so a row is
 * never a `fileRead` without a path or a `webFetch` without a URL.
 *
 * The command / file-change decision is `tool-call-operation.ts`'s, which the
 * permission mapping shares, so an approval row and its timeline item never
 * disagree (#1803).
 */

import type { DeltaFileChange, DeltaItemShape, DeltaPresentation } from "@bb/provider-bridge-protocol";
import { REASONING_PRESENTATION, extractResultText, fileReadPresentation, searchPresentation, toOptionalString, toolPresentation, webFetchPresentation } from "@bb/provider-bridge-protocol/bridge-kit";
import { z } from "zod";
import {
  commandPresentation,
  fileChangePresentation,
  toolKindPresentation,
  type AcpFileChangeVerb,
} from "./presentation.js";
import {
  classifyAcpToolCall as classifyAcpToolCallOperation,
  extractAcpToolCallPaths,
  resolveAcpToolCallPath,
  type AcpToolCallOperation,
  type AcpToolCallPathOptions,
} from "./tool-call-operation.js";
import {
  extractAcpContentText,
  type AcpToolCallUpdateEvent,
} from "./wire.js";

/** A tool call's item shape plus the presentation that rides its lifecycle. */
export interface AcpClassifiedToolCall {
  item: DeltaItemShape;
  presentation: DeltaPresentation;
}

/**
 * A bb-injected tool the session was constructed with (Q31). The definition
 * carries its presentation once the server resolved one; a definition from
 * before the field existed presents generically.
 */
export interface AcpInjectedTool {
  name: string;
  presentation?: DeltaPresentation;
}

/** The `server` a bb-injected tool call carries on the wire (Q31). */
const BB_TOOL_SERVER = "bb";

/**
 * Whether a tool call can be a call to a bb-injected tool: ACP agents report
 * MCP tool calls under the generic `other` kind (or no kind), never as a
 * command, a file change, or a native read/search/fetch/think.
 */
export function isInjectedToolCandidate(
  event: AcpToolCallUpdateEvent,
): boolean {
  if (event.kind !== undefined && event.kind !== "other") {
    return false;
  }
  return classifyAcpToolCallOperation(event).kind === "generic";
}

const INLINE_IMAGE_DATA_URL_PATTERN =
  /data:image\/[a-z0-9.+-]+(?:;[^,]*)?;base64,[a-z0-9+/_=-]+/giu;

/**
 * The most of a tool call's `rawInput` / `rawOutput` the timeline keeps, in
 * serialized characters. The server truncates string outputs on read; a JSON
 * object rides the event whole, so the bridge bounds it here.
 */
export const ACP_TOOL_PAYLOAD_MAX_CHARS = 64 * 1024;

function scrubInlineImageDataUrls(text: string): string {
  return text.replace(INLINE_IMAGE_DATA_URL_PATTERN, "[image]");
}

/** The data-URL scrub, applied to every string inside a JSON value. */
function scrubToolPayloadStrings(value: unknown): unknown {
  if (typeof value === "string") {
    return scrubInlineImageDataUrls(value);
  }
  if (Array.isArray(value)) {
    return value.map(scrubToolPayloadStrings);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        scrubToolPayloadStrings(entry),
      ]),
    );
  }
  return value;
}

function truncatedPayloadText(text: string): string {
  if (text.length <= ACP_TOOL_PAYLOAD_MAX_CHARS) {
    return text;
  }
  const removed = text.length - ACP_TOOL_PAYLOAD_MAX_CHARS;
  return `${text.slice(0, ACP_TOOL_PAYLOAD_MAX_CHARS)}\n…[${removed.toLocaleString("en-US")} more characters truncated]`;
}

/**
 * A tool call's `rawInput` or `rawOutput` as the timeline carries it: the
 * JSON value with inline image data URLs scrubbed, or — past the size cap —
 * its rendered text, head-truncated with the same marker the server's own
 * output truncation writes. Some ACP agents echo MCP image results as
 * data-URL attachments in rawOutput; the envelope stays, the potentially
 * multi-megabyte payload does not reach the timeline.
 */
export function boundAcpToolPayload(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  const scrubbed = scrubToolPayloadStrings(value);
  const serialized = JSON.stringify(scrubbed);
  if (serialized === undefined) {
    return undefined;
  }
  if (serialized.length <= ACP_TOOL_PAYLOAD_MAX_CHARS) {
    return scrubbed;
  }
  return truncatedPayloadText(
    typeof scrubbed === "string" ? scrubbed : extractResultText(scrubbed),
  );
}

/**
 * `rawInput` as `tool.args`: the assembler keeps only a JSON object as the
 * item's arguments, so a payload past the cap keeps its preview under one
 * key instead of vanishing.
 */
function boundAcpToolArgs(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const bounded = boundAcpToolPayload(value);
  if (typeof bounded === "string") {
    return { truncated: bounded };
  }
  return bounded !== null && typeof bounded === "object" && !Array.isArray(bounded)
    ? (bounded as Record<string, unknown>)
    : undefined;
}

function extractAcpToolCallContentText(
  event: AcpToolCallUpdateEvent,
): string | undefined {
  const chunks: string[] = [];
  for (const entry of event.content ?? []) {
    if (entry.type !== "content") {
      continue;
    }
    const text = extractAcpContentText(entry.content);
    if (text) {
      chunks.push(text);
    }
  }
  return chunks.length > 0 ? chunks.join("\n") : undefined;
}

/**
 * The text output of a tool call: its `content` text blocks, else its
 * `rawOutput` rendered as text (data URLs scrubbed).
 */
export function extractAcpToolCallOutputText(
  event: AcpToolCallUpdateEvent,
): string | undefined {
  const contentText = extractAcpToolCallContentText(event);
  if (contentText !== undefined) {
    return contentText;
  }
  if (event.rawOutput === undefined) {
    return undefined;
  }
  const rawOutputText = scrubInlineImageDataUrls(
    extractResultText(event.rawOutput),
  ).trim();
  return rawOutputText.length > 0 ? rawOutputText : undefined;
}

/**
 * What the agents in the wild put in a command's `rawOutput`. Cursor:
 * `{exitCode, stdout, stderr}`. grok: `{exit_code, output_for_prompt,
 * signal, timed_out, …}`. ACP itself standardizes none of it.
 */
const commandRawOutputSchema = z
  .object({
    exitCode: z.number().int().nullable().optional(),
    exit_code: z.number().int().nullable().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    output_for_prompt: z.string().optional(),
    signal: z.string().nullable().optional(),
    timed_out: z.boolean().optional(),
  })
  .passthrough();
type CommandRawOutput = z.infer<typeof commandRawOutputSchema>;

export interface AcpCommandResult {
  /** The process exit code the agent reported; absent when it reported none. */
  exitCode?: number;
  /** The command's output text; absent when the agent reported none. */
  output?: string;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

function joinStreams(stdout: string, stderr: string): string | undefined {
  if (stdout.length === 0 && stderr.length === 0) {
    return undefined;
  }
  if (stdout.length === 0 || stderr.length === 0) {
    return stdout.length > 0 ? stdout : stderr;
  }
  return stdout.endsWith("\n") ? `${stdout}${stderr}` : `${stdout}\n${stderr}`;
}

/**
 * What the agent SAID the command printed: its `content` text, else the
 * streams its `rawOutput` named. Never the envelope rendered as JSON.
 *
 * `reported` is the part that matters. An agent that named its streams has
 * told bb what the command printed even when that is nothing, and nothing is
 * what the row must show: `node -e "process.exit(3)"` prints nothing, and
 * before this the empty join fell through to the envelope and the row read
 * `{"exitCode":3,"stdout":"","stderr":""}`.
 */
function acpCommandOutputSoFar(
  event: AcpToolCallUpdateEvent,
  raw: CommandRawOutput | undefined,
): { reported: boolean; output: string | undefined } {
  const content = extractAcpToolCallContentText(event);
  if (content !== undefined) {
    return { reported: true, output: content };
  }
  // A bare string `rawOutput` is the output, not an envelope to render: an
  // agent that sends one has told bb what the command printed, mid-flight as
  // much as at the close. No agent bb has read the wire for sends this, and
  // that is exactly why it must keep working — the generality costs nothing.
  if (typeof event.rawOutput === "string") {
    return {
      reported: true,
      output: emptyToUndefined(
        scrubInlineImageDataUrls(event.rawOutput).trim(),
      ),
    };
  }
  if (raw === undefined) {
    return { reported: false, output: undefined };
  }
  if (raw.stdout !== undefined || raw.stderr !== undefined) {
    return {
      reported: true,
      output: joinStreams(raw.stdout ?? "", raw.stderr ?? ""),
    };
  }
  if (raw.output_for_prompt !== undefined) {
    return { reported: true, output: emptyToUndefined(raw.output_for_prompt) };
  }
  return { reported: false, output: undefined };
}

/**
 * What a RUNNING command has printed so far, for the streamed snapshot.
 *
 * Mid-flight the rendered-envelope fallback is always wrong: a JSON object is
 * not "output so far", and the envelope carries an `exit_code` the command
 * has not reached. An agent whose in-progress envelope names no stream has
 * told bb nothing, and nothing is what the row shows until the close.
 */
export function extractAcpStreamedCommandOutput(
  event: AcpToolCallUpdateEvent,
): string | undefined {
  const parsed = commandRawOutputSchema.safeParse(event.rawOutput);
  const { output } = acpCommandOutputSoFar(
    event,
    parsed.success ? parsed.data : undefined,
  );
  return output === undefined ? undefined : scrubInlineImageDataUrls(output);
}

/**
 * The real result of a command: the exit code the agent reported (never
 * synthesized from its status) and its output.
 *
 * Output precedence: the `content` text the agent chose to show; else a bare
 * string `rawOutput`; else stdout+stderr from the `rawOutput` envelope; else
 * grok's `output_for_prompt`; else the envelope rendered as JSON. An agent
 * that NAMED a stream has reported what the command printed even when that is
 * nothing, so an empty one shows nothing rather than falling through to the
 * envelope. A timeout or a terminating signal is noted after the output.
 *
 * The rendered-envelope fallback stays at the CLOSE, where an agent that
 * reported no stream at all has still finished and its envelope is the only
 * record of what happened.
 */
export function extractAcpCommandResult(
  event: AcpToolCallUpdateEvent,
): AcpCommandResult {
  const parsed = commandRawOutputSchema.safeParse(event.rawOutput);
  const raw = parsed.success ? parsed.data : undefined;
  const exitCode = raw?.exitCode ?? raw?.exit_code ?? undefined;
  const reported = acpCommandOutputSoFar(event, raw);
  let output = reported.reported
    ? reported.output
    : extractAcpToolCallOutputText(event);
  const notes = [
    ...(raw?.timed_out === true ? ["[timed out]"] : []),
    ...(raw?.signal ? [`[signal ${raw.signal}]`] : []),
  ];
  if (notes.length > 0) {
    const body = output ?? "";
    output = `${body}${body.length > 0 && !body.endsWith("\n") ? "\n" : ""}${notes.join(" ")}`;
  }
  return {
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(output === undefined ? {} : { output: scrubInlineImageDataUrls(output) }),
  };
}

// ---------------------------------------------------------------------------
// Argument schemas (one-off, dialect-local). ACP does not standardize
// rawInput; these are the field names the agents in the wild use.
// ---------------------------------------------------------------------------

const optionalNonBlank = z
  .string()
  .optional()
  .transform((value) =>
    value !== undefined && value.trim().length > 0 ? value : undefined,
  );

const searchRawInputSchema = z
  .object({
    pattern: optionalNonBlank,
    query: optionalNonBlank,
    regex: optionalNonBlank,
    glob: optionalNonBlank,
    globPattern: optionalNonBlank,
    path: optionalNonBlank,
    directory: optionalNonBlank,
  })
  .passthrough();

const fetchRawInputSchema = z
  .object({ url: optionalNonBlank, uri: optionalNonBlank })
  .passthrough();

const thinkRawInputSchema = z
  .object({ thought: optionalNonBlank, thinking: optionalNonBlank })
  .passthrough();

/**
 * Agents put the one thing a call is about in the title when they put it
 * nowhere else: grok titles a read "Read `/abs/path`" and a fetch
 * "Fetch: https://…". A single code-ticked token, or a single URL, in the
 * title of a call of that kind is that thing.
 */
const SINGLE_TICKED_TOKEN_PATTERN = /^[^`]*`([^`\n]+)`[^`]*$/;
const URL_PATTERN = /https?:\/\/[^\s`'"<>]+/g;

function tickedTokenFromTitle(title: string | undefined): string | undefined {
  if (title === undefined) {
    return undefined;
  }
  const match = SINGLE_TICKED_TOKEN_PATTERN.exec(title);
  const token = match?.[1]?.trim();
  return token !== undefined && token.length > 0 ? token : undefined;
}

function urlFromTitle(title: string | undefined): string | undefined {
  if (title === undefined) {
    return undefined;
  }
  const urls = title.match(URL_PATTERN);
  return urls !== null && urls.length === 1 ? urls[0] : undefined;
}

function looksLikePath(token: string): boolean {
  return (
    token.startsWith("/") || token.startsWith("~") || token.startsWith(".")
  );
}

// ---------------------------------------------------------------------------
// Per-kind shapes
// ---------------------------------------------------------------------------

/** The verb a set of file changes reads as: all adds, all deletes, else edits. */
function fileChangeVerb(
  changes: readonly DeltaFileChange[],
  fallback: AcpFileChangeVerb,
): AcpFileChangeVerb {
  if (changes.length === 0) {
    return fallback;
  }
  if (changes.every((change) => change.kind === "add")) {
    return "add";
  }
  if (changes.every((change) => change.kind === "delete")) {
    return "delete";
  }
  return "update";
}

function buildAcpFileChanges(
  event: AcpToolCallUpdateEvent,
  operation: Extract<AcpToolCallOperation, { kind: "file_change" }>,
  options: AcpToolCallPathOptions | undefined,
): DeltaFileChange[] {
  const changes: DeltaFileChange[] = [];
  for (const entry of event.content ?? []) {
    if (entry.type !== "diff") {
      continue;
    }
    const oldText = entry.oldText ?? undefined;
    changes.push({
      path: resolveAcpToolCallPath(entry.path, options),
      kind: oldText === undefined ? "add" : "update",
      ...(oldText === undefined ? {} : { oldText }),
      newText: entry.newText,
    });
  }
  if (changes.length > 0) {
    return changes;
  }
  const [path] = operation.paths;
  return path === undefined ? [] : [{ path, kind: operation.changeKind }];
}

function fileChangeItem(
  changes: DeltaFileChange[],
  fallbackVerb: AcpFileChangeVerb,
): AcpClassifiedToolCall {
  return {
    item: { type: "fileChange", changes },
    presentation: fileChangePresentation({
      verb: fileChangeVerb(changes, fallbackVerb),
      paths: changes.map((change) => change.path),
    }),
  };
}

function fileReadItem(
  event: AcpToolCallUpdateEvent,
  title: string | undefined,
  options: AcpToolCallPathOptions | undefined,
): AcpClassifiedToolCall | null {
  const ticked = tickedTokenFromTitle(title);
  const path =
    extractAcpToolCallPaths(event, options)[0] ??
    (ticked !== undefined && looksLikePath(ticked) ? ticked : undefined);
  if (path === undefined) {
    return null;
  }
  return {
    item: { type: "fileRead", path },
    presentation: fileReadPresentation(path),
  };
}

function searchItem(
  event: AcpToolCallUpdateEvent,
): AcpClassifiedToolCall | null {
  const parsed = searchRawInputSchema.safeParse(event.rawInput);
  if (!parsed.success) {
    return null;
  }
  const input = parsed.data;
  const glob = input.glob ?? input.globPattern;
  const contentQuery = input.pattern ?? input.query ?? input.regex;
  const mode = contentQuery !== undefined ? "content" : "path";
  const query = contentQuery ?? glob;
  if (query === undefined) {
    return null;
  }
  const root = input.path ?? input.directory;
  return {
    item: {
      type: "search",
      mode,
      query,
      ...(root === undefined ? {} : { path: root }),
    },
    presentation: searchPresentation({ mode, query }),
  };
}

function webFetchItem(
  event: AcpToolCallUpdateEvent,
  title: string | undefined,
): AcpClassifiedToolCall | null {
  const parsed = fetchRawInputSchema.safeParse(event.rawInput);
  const url =
    (parsed.success ? (parsed.data.url ?? parsed.data.uri) : undefined) ??
    urlFromTitle(title);
  if (url === undefined) {
    return null;
  }
  return {
    item: { type: "webFetch", url, pattern: null },
    presentation: webFetchPresentation(url),
  };
}

/**
 * A `think` call is the agent's reasoning as a tool: the thought is the
 * call's content text, else its `rawInput` thought field; an in-flight call
 * with neither opens empty and fills in at the close.
 */
function reasoningItem(event: AcpToolCallUpdateEvent): AcpClassifiedToolCall {
  const parsed = thinkRawInputSchema.safeParse(event.rawInput);
  const thought =
    extractAcpToolCallOutputText(event) ??
    (parsed.success
      ? (parsed.data.thought ?? parsed.data.thinking)
      : undefined);
  return {
    item: {
      type: "reasoning",
      summary: [],
      content: thought === undefined ? [] : [thought],
    },
    presentation: REASONING_PRESENTATION,
  };
}

/**
 * The generic fields every `tool` item carries: `rawInput` as `args`,
 * `rawOutput` as `result`, and the output text as `error` when the call
 * failed. Absent fields stay absent.
 */
function genericToolFields(
  event: AcpToolCallUpdateEvent,
): Pick<Extract<DeltaItemShape, { type: "tool" }>, "args" | "result" | "error"> {
  const args = boundAcpToolArgs(event.rawInput);
  const result = boundAcpToolPayload(event.rawOutput);
  const error =
    event.status === "failed" ? extractAcpToolCallOutputText(event) : undefined;
  return {
    ...(args === undefined ? {} : { args }),
    ...(result === undefined ? {} : { result }),
    ...(error === undefined ? {} : { error }),
  };
}

/**
 * A generic tool names itself by its programmatic name when the agent
 * reports one (the unstable `name`, or the dialect's side channel), else by
 * its kind; a kind the wire schema did not know keeps the agent's own word
 * (`rawKind`) in the tool slot and presents as `other`.
 */
function genericToolItem(
  event: AcpToolCallUpdateEvent,
  title: string | undefined,
): AcpClassifiedToolCall {
  const name = toOptionalString(event.name);
  return {
    item: {
      type: "tool",
      tool: name ?? event.rawKind ?? event.kind ?? "tool",
      ...genericToolFields(event),
    },
    presentation: toolKindPresentation({ kind: event.kind, name, title }),
  };
}

/**
 * A call to a bb-injected tool: `server: "bb"` names its origin and the
 * definition the server handed the bridge says how the row reads, so no
 * tool-name table is needed anywhere downstream.
 */
function bbToolItem(
  event: AcpToolCallUpdateEvent,
  injected: AcpInjectedTool,
): AcpClassifiedToolCall {
  return {
    item: {
      type: "tool",
      tool: injected.name,
      server: BB_TOOL_SERVER,
      ...genericToolFields(event),
    },
    presentation: injected.presentation ?? toolPresentation(injected.name),
  };
}

/**
 * Classify a (merged) tool_call event into its item shape and presentation.
 * A call bound to a bb-injected tool reads as that tool. Otherwise command
 * and file-change come first, from the shared operation classifier (a diff
 * makes any kind a file change); then the native kind picks the shape; a
 * kind whose shape the agent left unfilled is a generic tool presenting as
 * its kind.
 */
export function classifyAcpToolCall(
  event: AcpToolCallUpdateEvent,
  injected?: AcpInjectedTool,
  options?: AcpToolCallPathOptions,
): AcpClassifiedToolCall {
  if (injected !== undefined && isInjectedToolCandidate(event)) {
    return bbToolItem(event, injected);
  }
  const operation = classifyAcpToolCallOperation(event, options);
  if (operation.kind === "command") {
    // ACP never says where the agent ran a command; the session cwd is where
    // the agent process runs, so that is the command's cwd. Without one the
    // call stays a generic tool item: bb fabricates no `commandExecution
    // { cwd: "" }` (design §4).
    const cwd = toOptionalString(options?.cwd);
    if (cwd !== undefined) {
      return {
        item: { type: "command", command: operation.command, cwd },
        presentation: commandPresentation(operation.command),
      };
    }
  }
  if (operation.kind === "file_change") {
    const changes = buildAcpFileChanges(event, operation, options);
    return fileChangeItem(changes, operation.changeKind);
  }
  const title = toOptionalString(event.title);
  switch (event.kind) {
    case "read":
      return (
        fileReadItem(event, title, options) ?? genericToolItem(event, title)
      );
    case "search":
      return searchItem(event) ?? genericToolItem(event, title);
    case "fetch":
      return webFetchItem(event, title) ?? genericToolItem(event, title);
    case "think":
      return reasoningItem(event);
    case "execute":
    case "edit":
    case "delete":
    case "move":
    case "switch_mode":
    case "other":
    case undefined:
      return genericToolItem(event, title);
  }
}
