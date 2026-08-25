/**
 * One classifier for ACP tool calls.
 *
 * The timeline (`delta-translation.ts`) and the permission mapping
 * (`interactions.ts`) both decide whether an ACP tool call is a shell command,
 * a file change, or a generic tool. They must agree: the server materializes a
 * permission subject as a timeline item with the ACP tool-call id, so a
 * mismatch flips one row between item types (get-bb/bb#1719).
 */

import path from "node:path";
import { toOptionalString } from "@bb/provider-bridge-protocol/bridge-kit";
import { z } from "zod";
import type { AcpToolCallContent } from "./wire.js";

/** The fields of an ACP tool call that drive classification. */
export interface AcpToolCallOperationInput {
  title?: string | undefined;
  kind?: string | undefined;
  content?: readonly AcpToolCallContent[] | undefined;
  locations?: readonly { path: string }[] | undefined;
  rawInput?: unknown;
}

export type AcpToolCallOperation =
  | { kind: "command"; command: string }
  | {
      kind: "file_change";
      changeKind: "update" | "delete";
      /** Non-blank paths the tool call names, in wire order. */
      paths: readonly string[];
    }
  | { kind: "generic" };

const acpRawInputCommandSchema = z
  .object({ command: z.string() })
  .passthrough();
const acpRawInputPathSchema = z
  .object({
    path: z.string().optional(),
    filePath: z.string().optional(),
    file_path: z.string().optional(),
    /** grok's `read_file` / `search_replace` argument name. */
    target_file: z.string().optional(),
  })
  .passthrough();

/**
 * Where a tool call's paths resolve. ACP says `locations[].path` and diff
 * paths are absolute; grok sends them relative to the session cwd
 * (`README.md`), so a session resolves every named path against its cwd
 * before a path reaches an item. Without a cwd the paths pass through as
 * sent.
 */
export interface AcpToolCallPathOptions {
  cwd?: string | undefined;
}

export function resolveAcpToolCallPath(
  value: string,
  options: AcpToolCallPathOptions | undefined,
): string {
  const cwd = options?.cwd;
  if (cwd === undefined || path.isAbsolute(value) || value.startsWith("~")) {
    return value;
  }
  return path.resolve(cwd, value);
}

/** The shell command of an execute tool call: `rawInput.command`, else title. */
export function extractAcpCommand(
  event: Pick<AcpToolCallOperationInput, "rawInput" | "title">,
): string | undefined {
  const parsed = acpRawInputCommandSchema.safeParse(event.rawInput);
  if (parsed.success && parsed.data.command.trim().length > 0) {
    return parsed.data.command;
  }
  return toOptionalString(event.title);
}

function isNonBlank(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Every non-blank path the tool call names: diff content paths, then
 * `locations`, then the conventional `rawInput` path fields — each resolved
 * against the session cwd when one is given.
 */
export function extractAcpToolCallPaths(
  event: Pick<AcpToolCallOperationInput, "content" | "locations" | "rawInput">,
  options?: AcpToolCallPathOptions,
): string[] {
  const paths: string[] = [];
  for (const entry of event.content ?? []) {
    if (entry.type === "diff" && isNonBlank(entry.path)) {
      paths.push(resolveAcpToolCallPath(entry.path, options));
    }
  }
  for (const location of event.locations ?? []) {
    if (isNonBlank(location.path)) {
      paths.push(resolveAcpToolCallPath(location.path, options));
    }
  }
  if (paths.length > 0) {
    return paths;
  }
  const parsed = acpRawInputPathSchema.safeParse(event.rawInput);
  if (!parsed.success) {
    return [];
  }
  const rawInputPath = [
    parsed.data.path,
    parsed.data.filePath,
    parsed.data.file_path,
    parsed.data.target_file,
  ].find(isNonBlank);
  return rawInputPath === undefined ? [] : [resolveAcpToolCallPath(rawInputPath, options)];
}

/**
 * Classify an ACP tool call. An `execute` tool with a command is a command. A
 * tool with diff content, or an `edit`/`delete` tool, is a file change. The
 * native kind is already a write signal even when the path arrives only on a
 * later update (OpenCode and Cursor both do this); classifying the
 * path-pending start as a generic tool would make one call project as two
 * timeline rows. Everything else, including ACP's generic `other` kind, is a
 * generic tool: locations alone are not a write signal, because read-only
 * tools name locations too.
 */
export function classifyAcpToolCall(
  event: AcpToolCallOperationInput,
  options?: AcpToolCallPathOptions,
): AcpToolCallOperation {
  if (event.kind === "execute") {
    const command = extractAcpCommand(event);
    if (command) {
      return { kind: "command", command };
    }
  }
  const paths = extractAcpToolCallPaths(event, options);
  const hasDiff = (event.content ?? []).some((entry) => entry.type === "diff");
  if (hasDiff || event.kind === "edit") {
    return { kind: "file_change", changeKind: "update", paths };
  }
  if (event.kind === "delete") {
    return { kind: "file_change", changeKind: "delete", paths };
  }
  return { kind: "generic" };
}

/**
 * The write boundary of a file change: the one named path that contains every
 * other named path (opencode's `external_directory` permission names
 * `[file, parentDir]`), else null. Paths are normalized first so `..`
 * segments cannot fake containment. Linear in the number of paths.
 */
export function resolveAcpFileChangeWriteScope(
  paths: readonly string[],
): string | null {
  const normalized = paths.filter(isNonBlank).map((entry) => {
    const value = path.normalize(entry);
    return value.length > 1 && value.endsWith(path.sep)
      ? value.slice(0, -1)
      : value;
  });
  const [first, ...rest] = normalized;
  if (first === undefined) {
    return null;
  }
  let candidate = first;
  for (const entry of rest) {
    if (entry.length < candidate.length) {
      candidate = entry;
    }
  }
  const prefix = candidate.endsWith(path.sep)
    ? candidate
    : candidate + path.sep;
  for (const entry of normalized) {
    if (entry !== candidate && !entry.startsWith(prefix)) {
      return null;
    }
  }
  return candidate;
}
