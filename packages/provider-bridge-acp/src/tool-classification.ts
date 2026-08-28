import type {
  DeltaFileChange,
  DeltaPresentation,
} from "@bb/provider-bridge-protocol";
import type * as BridgeProtocol from "@bb/provider-bridge-protocol";
import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
} from "@bb/domain";
import {
  REASONING_PRESENTATION,
  extractResultText,
  fileReadPresentation,
  searchPresentation,
  toOptionalString,
  toolPresentation,
  webFetchPresentation,
} from "@bb/provider-bridge-protocol/bridge-kit";
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
import { extractAcpContentText, type AcpToolCallUpdateEvent } from "./wire.js";

export interface AcpClassifiedToolCall {
  item: z.infer<(typeof BridgeProtocol)["deltaItemShapeSchema"]>;
  presentation: DeltaPresentation;
}

export interface AcpInjectedTool {
  name: string;
  presentation?: DeltaPresentation;
}

const BB_TOOL_SERVER = "bb";

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

export const ACP_TOOL_PAYLOAD_MAX_CHARS = 64 * 1024;

type AcpToolPayload = JsonValue | undefined;

function parseAcpToolPayload(
  value: AcpToolCallUpdateEvent["rawOutput"],
): AcpToolPayload {
  const parsed = jsonValueSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function scrubInlineImageDataUrls(text: string): string {
  return text.replace(INLINE_IMAGE_DATA_URL_PATTERN, "[image]");
}

function scrubToolPayloadStrings(value: JsonValue): JsonValue {
  const stringValue = z.string().safeParse(value);
  if (stringValue.success) {
    return scrubInlineImageDataUrls(stringValue.data);
  }
  if (Array.isArray(value)) {
    return value.map(scrubToolPayloadStrings);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return jsonObjectSchema.parse(
    Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        scrubToolPayloadStrings(entry),
      ]),
    ),
  );
}

function truncatedPayloadText(text: string): string {
  if (text.length <= ACP_TOOL_PAYLOAD_MAX_CHARS) {
    return text;
  }
  const removed = text.length - ACP_TOOL_PAYLOAD_MAX_CHARS;
  return `${text.slice(0, ACP_TOOL_PAYLOAD_MAX_CHARS)}\n…[${removed.toLocaleString("en-US")} more characters truncated]`;
}

export function boundAcpToolPayload(
  value: AcpToolPayload,
): AcpToolPayload | string {
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
  const scrubbedString = z.string().safeParse(scrubbed);
  return truncatedPayloadText(
    scrubbedString.success ? scrubbedString.data : extractResultText(scrubbed),
  );
}

function boundAcpToolArgs(value: AcpToolPayload): JsonObject | undefined {
  const objectValue = jsonObjectSchema.safeParse(value);
  if (!objectValue.success) {
    return undefined;
  }
  const bounded = boundAcpToolPayload(objectValue.data);
  const boundedString = z.string().safeParse(bounded);
  if (boundedString.success) {
    return { truncated: boundedString.data };
  }
  const boundedObject = jsonObjectSchema.safeParse(bounded);
  return boundedObject.success ? boundedObject.data : undefined;
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

export function extractAcpToolCallOutputText(
  event: AcpToolCallUpdateEvent,
): string | undefined {
  const contentText = extractAcpToolCallContentText(event);
  if (contentText !== undefined) {
    return contentText;
  }
  const rawOutput = parseAcpToolPayload(event.rawOutput);
  if (rawOutput === undefined) {
    return undefined;
  }
  const rawOutputText = scrubInlineImageDataUrls(
    extractResultText(rawOutput),
  ).trim();
  return rawOutputText.length > 0 ? rawOutputText : undefined;
}

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

interface AcpCommandOutputSoFar {
  reported: boolean;
  output: string | undefined;
}

export interface AcpCommandResult {
  exitCode?: number;
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

function acpCommandOutputSoFar(
  event: AcpToolCallUpdateEvent,
  raw: CommandRawOutput | undefined,
): AcpCommandOutputSoFar {
  const content = extractAcpToolCallContentText(event);
  if (content !== undefined) {
    return { reported: true, output: content };
  }
  const rawOutput = parseAcpToolPayload(event.rawOutput);
  const rawOutputText = z.string().safeParse(rawOutput);
  if (rawOutputText.success) {
    return {
      reported: true,
      output: emptyToUndefined(
        scrubInlineImageDataUrls(rawOutputText.data).trim(),
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
  const result: AcpCommandResult = {};
  if (exitCode !== undefined) {
    result.exitCode = exitCode;
  }
  if (output !== undefined) {
    result.output = scrubInlineImageDataUrls(output);
  }
  return result;
}

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
    const change: DeltaFileChange = {
      path: resolveAcpToolCallPath(entry.path, options),
      kind: oldText === undefined ? "add" : "update",
      newText: entry.newText,
    };
    if (oldText !== undefined) {
      change.oldText = oldText;
    }
    changes.push(change);
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
  const item: Extract<
    z.infer<(typeof BridgeProtocol)["deltaItemShapeSchema"]>,
    { type: "search" }
  > = {
    type: "search",
    mode,
    query,
  };
  if (root !== undefined) {
    item.path = root;
  }
  return {
    item,
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

function genericToolFields(
  event: AcpToolCallUpdateEvent,
): Pick<
  Extract<
    z.infer<(typeof BridgeProtocol)["deltaItemShapeSchema"]>,
    { type: "tool" }
  >,
  "args" | "result" | "error"
> {
  const args = boundAcpToolArgs(parseAcpToolPayload(event.rawInput));
  const result = boundAcpToolPayload(parseAcpToolPayload(event.rawOutput));
  const error =
    event.status === "failed" ? extractAcpToolCallOutputText(event) : undefined;
  const fields: Pick<
    Extract<
      z.infer<(typeof BridgeProtocol)["deltaItemShapeSchema"]>,
      { type: "tool" }
    >,
    "args" | "result" | "error"
  > = {};
  if (args !== undefined) {
    fields.args = args;
  }
  if (result !== undefined) {
    fields.result = result;
  }
  if (error !== undefined) {
    fields.error = error;
  }
  return fields;
}

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
  return genericToolItem(event, title);
}
