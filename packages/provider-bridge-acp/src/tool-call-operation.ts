import path from "node:path";
import { toOptionalString } from "@bb/provider-bridge-protocol/bridge-kit";
import { z } from "zod";
import {
  agentPathFlavorForAnchor,
  isWin32ShapedPath,
  type AgentPathFlavor,
} from "./agent-paths.js";
import type { AcpToolCallContent } from "./wire.js";

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
    target_file: z.string().optional(),
  })
  .passthrough();

export interface AcpToolCallPathOptions {
  cwd?: string | undefined;
}

function resolveFlavor(value: string, cwd: string): AgentPathFlavor {
  if (isWin32ShapedPath(value)) return agentPathFlavorForAnchor(value);
  if (value.startsWith("/")) return agentPathFlavorForAnchor(value);
  return agentPathFlavorForAnchor(cwd);
}

export function resolveAcpToolCallPath(
  value: string,
  options: AcpToolCallPathOptions | undefined,
): string {
  const cwd = options?.cwd;
  if (cwd === undefined || value.startsWith("~")) {
    return value;
  }
  const flavor = resolveFlavor(value, cwd);
  if (flavor.isAbsolute(value)) {
    return value;
  }
  return flavor.resolve(cwd, value);
}

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
  return rawInputPath === undefined
    ? []
    : [resolveAcpToolCallPath(rawInputPath, options)];
}

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

export function resolveAcpFileChangeWriteScope(
  paths: readonly string[],
): string | null {
  const nonBlank = paths.filter(isNonBlank);
  if (nonBlank.length === 0) {
    return null;
  }
  if (
    nonBlank.some((entry) => isWin32ShapedPath(entry)) &&
    nonBlank.some((entry) => !isWin32ShapedPath(entry))
  ) {
    return null;
  }
  const flavor = nonBlank.some(isWin32ShapedPath) ? path.win32 : path.posix;
  const normalized = nonBlank.map((entry) => {
    const value = flavor.normalize(entry);
    return value.length > 1 && value.endsWith(flavor.sep)
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
  const prefix = candidate.endsWith(flavor.sep)
    ? candidate
    : candidate + flavor.sep;
  for (const entry of normalized) {
    if (entry !== candidate && !entry.startsWith(prefix)) {
      return null;
    }
  }
  return candidate;
}
