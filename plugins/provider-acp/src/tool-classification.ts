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

import {
  extractResultText,
  toOptionalString,
  type DeltaFileChange,
  type DeltaItemShape,
  type DeltaPresentation,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import {
  bbToolPresentation,
  commandPresentation,
  fileChangePresentation,
  fileReadPresentation,
  reasoningPresentation,
  searchPresentation,
  toolKindPresentation,
  webFetchPresentation,
  type AcpFileChangeVerb,
} from "./presentation.js";
import {
  classifyAcpToolCall as classifyAcpToolCallOperation,
  extractAcpToolCallPaths,
  type AcpToolCallOperation,
} from "./tool-call-operation.js";
import {
  extractAcpContentText,
  type AcpToolCallUpdateEvent,
  type AcpToolKind,
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
 * The text output of a tool call: its `content` text blocks, else its
 * `rawOutput` rendered as text. Some ACP agents echo MCP image results as
 * data-URL attachments in rawOutput; the envelope stays, the potentially
 * multi-megabyte payload does not reach the timeline.
 */
export function extractAcpToolCallOutputText(
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
  if (chunks.length > 0) {
    return chunks.join("\n");
  }
  if (event.rawOutput === undefined) {
    return undefined;
  }
  const rawOutputText = extractResultText(event.rawOutput)
    .replace(INLINE_IMAGE_DATA_URL_PATTERN, "[image]")
    .trim();
  return rawOutputText.length > 0 ? rawOutputText : undefined;
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
): AcpFileChangeVerb {
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
): DeltaFileChange[] {
  const changes: DeltaFileChange[] = [];
  for (const entry of event.content ?? []) {
    if (entry.type !== "diff") {
      continue;
    }
    const oldText = entry.oldText ?? undefined;
    changes.push({
      path: entry.path,
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

function fileChangeItem(changes: DeltaFileChange[]): AcpClassifiedToolCall {
  return {
    item: { type: "fileChange", changes },
    presentation: fileChangePresentation({
      verb: fileChangeVerb(changes),
      paths: changes.map((change) => change.path),
    }),
  };
}

function fileReadItem(
  event: AcpToolCallUpdateEvent,
  title: string | undefined,
): AcpClassifiedToolCall | null {
  const ticked = tickedTokenFromTitle(title);
  const path =
    extractAcpToolCallPaths(event)[0] ??
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
    presentation: reasoningPresentation(),
  };
}

function genericToolItem(
  kind: AcpToolKind | undefined,
  title: string | undefined,
): AcpClassifiedToolCall {
  return {
    item: { type: "tool", tool: kind ?? "tool" },
    presentation: toolKindPresentation({ kind, title }),
  };
}

/**
 * A call to a bb-injected tool: `server: "bb"` names its origin and the
 * definition the server handed the bridge says how the row reads, so no
 * tool-name table is needed anywhere downstream.
 */
function bbToolItem(injected: AcpInjectedTool): AcpClassifiedToolCall {
  return {
    item: { type: "tool", tool: injected.name, server: BB_TOOL_SERVER },
    presentation: injected.presentation ?? bbToolPresentation(injected.name),
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
): AcpClassifiedToolCall {
  if (injected !== undefined && isInjectedToolCandidate(event)) {
    return bbToolItem(injected);
  }
  const operation = classifyAcpToolCallOperation(event);
  if (operation.kind === "command") {
    return {
      item: { type: "command", command: operation.command, cwd: "" },
      presentation: commandPresentation(operation.command),
    };
  }
  if (operation.kind === "file_change") {
    const changes = buildAcpFileChanges(event, operation);
    if (changes.length > 0) {
      return fileChangeItem(changes);
    }
  }
  const title = toOptionalString(event.title);
  switch (event.kind) {
    case "read":
      return fileReadItem(event, title) ?? genericToolItem(event.kind, title);
    case "search":
      return searchItem(event) ?? genericToolItem(event.kind, title);
    case "fetch":
      return webFetchItem(event, title) ?? genericToolItem(event.kind, title);
    case "think":
      return reasoningItem(event);
    case "execute":
    case "edit":
    case "delete":
    case "move":
    case "other":
    case undefined:
      return genericToolItem(event.kind, title);
  }
}
