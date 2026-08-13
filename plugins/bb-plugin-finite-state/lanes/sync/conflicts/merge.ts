import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import type { EntityAdapter } from "../engine/adapter.js";
import { canonicalJson } from "../serialize/canonical.js";
import { emitYaml } from "../serialize/yaml.js";

export interface SemanticNode {
  present: boolean;
  value: unknown;
}

export interface SetMergeResult {
  merged: unknown[];
  opposed: boolean;
}

export interface WorkingMaterializationInput {
  adapter: EntityAdapter;
  worktreeRoot: string;
  key: string;
  file: string | null;
  expectedFileSha256: string | null;
  currentPayload: Record<string, unknown> | undefined;
  nextPayload: Record<string, unknown> | undefined;
}

export interface WorkingMaterialization {
  rollback(): Promise<void>;
}

export class WorkingMaterializationError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkingMaterializationError";
  }
}

export function escapePointerSegment(segment: string): string {
  return segment.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

export function pointerChild(path: string, segment: string): string {
  return `${path}/${escapePointerSegment(segment)}`;
}

export function pointerSegments(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) throw new TypeError(`Invalid RFC 6901 JSON pointer: ${path}`);
  return path.slice(1).split("/").map((segment) => {
    if (/~(?![01])/u.test(segment)) throw new TypeError(`Invalid RFC 6901 JSON pointer: ${path}`);
    return segment.replace(/~1/gu, "/").replace(/~0/gu, "~");
  });
}

export function sameSemanticNode(left: SemanticNode, right: SemanticNode): boolean {
  if (left.present !== right.present) return false;
  return !left.present || canonicalJson(left.value) === canonicalJson(right.value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function sha256Text(bytes: string): string {
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

export function confinedWorkingFile(root: string, relativeFile: string): string {
  const absoluteRoot = resolve(root);
  const absolute = resolve(absoluteRoot, ...relativeFile.split("/"));
  if (absolute !== absoluteRoot && !absolute.startsWith(`${absoluteRoot}${sep}`)) {
    throw new WorkingMaterializationError(
      "WORKING_PATH_INVALID",
      "Adapter returned a file outside the worktree",
    );
  }
  return absolute;
}

function semanticCandidateMatches(
  candidate: Record<string, unknown>,
  payload: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(payload).every(([key, value]) => (
    Object.hasOwn(candidate, key) && canonicalJson(candidate[key]) === canonicalJson(value)
  ));
}

function semanticCandidates(
  value: unknown,
  payload: Readonly<Record<string, unknown>>,
  depth = 0,
): Array<{ value: Record<string, unknown>; depth: number }> {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => semanticCandidates(entry, payload, depth + 1));
  }
  if (!isRecord(value)) return [];
  const result = semanticCandidateMatches(value, payload) ? [{ value, depth }] : [];
  for (const [key, child] of Object.entries(value)) {
    if (key !== "sync") result.push(...semanticCandidates(child, payload, depth + 1));
  }
  return result;
}

async function replaceFileCas(
  file: string,
  expectedSha256: string,
  contents: string,
): Promise<WorkingMaterialization> {
  const original = await readFile(file, "utf8");
  if (sha256Text(original) !== expectedSha256) {
    throw new WorkingMaterializationError(
      "FILE_STALE",
      "Working YAML changed before semantic materialization",
    );
  }
  const metadata = await stat(file);
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const writtenSha256 = sha256Text(contents);
  try {
    await writeFile(temporary, contents, { encoding: "utf8", mode: metadata.mode });
    if (sha256Text(await readFile(file, "utf8")) !== expectedSha256) {
      throw new WorkingMaterializationError(
        "FILE_STALE",
        "Working YAML changed during semantic materialization",
      );
    }
    await rename(temporary, file);
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  return {
    async rollback() {
      if (sha256Text(await readFile(file, "utf8")) !== writtenSha256) {
        throw new WorkingMaterializationError(
          "ROLLBACK_STALE",
          "Working YAML changed before materialization rollback",
        );
      }
      const rollback = `${file}.${process.pid}.${randomUUID()}.rollback`;
      try {
        await writeFile(rollback, original, { encoding: "utf8", mode: metadata.mode });
        await rename(rollback, file);
      } catch (error: unknown) {
        await rm(rollback, { force: true }).catch(() => undefined);
        throw error;
      }
    },
  };
}

/**
 * Locates one adapter-owned semantic mapping, preserves document identity and
 * bookkeeping fields, serializes through that adapter, and writes with SHA CAS.
 */
export async function materializeExistingWorking(
  input: WorkingMaterializationInput,
): Promise<WorkingMaterialization> {
  if (
    input.file === null
    || input.expectedFileSha256 === null
    || input.currentPayload === undefined
    || input.nextPayload === undefined
  ) {
    throw new WorkingMaterializationError(
      "WORKING_MATERIALIZER_REQUIRED",
      `${input.adapter.kind}/${input.key} requires its surface-owned create/delete materializer`,
    );
  }
  const file = confinedWorkingFile(input.worktreeRoot, input.file);
  const document = input.adapter.serializer.fromYaml(await readFile(file, "utf8"), input.file);
  const candidates = semanticCandidates(document, input.currentPayload);
  const shallowest = candidates.reduce((minimum, candidate) => Math.min(minimum, candidate.depth), Infinity);
  const matches = candidates.filter((candidate) => candidate.depth === shallowest);
  const target = matches[0];
  if (target === undefined || matches.length !== 1) {
    throw new WorkingMaterializationError(
      "WORKING_LOCATION_AMBIGUOUS",
      `Registered adapter could not identify one semantic mapping for ${input.adapter.kind}/${input.key}`,
    );
  }
  for (const key of Object.keys(input.currentPayload)) {
    if (!Object.hasOwn(input.nextPayload, key)) delete target.value[key];
  }
  for (const [key, value] of Object.entries(input.nextPayload)) {
    target.value[key] = structuredClone(value);
  }
  const contents = emitYaml(document);
  input.adapter.serializer.fromYaml(contents, input.file);
  return replaceFileCas(file, input.expectedFileSha256, contents);
}

function memberIdentity(value: unknown): string {
  if (isRecord(value)) {
    for (const field of ["id", "key", "slug", "name"]) {
      const identity = value[field];
      if (typeof identity === "string" || typeof identity === "number") {
        return `${field}:${canonicalJson(identity)}`;
      }
    }
    if (Object.hasOwn(value, "source") && Object.hasOwn(value, "target")) {
      return `edge:${canonicalJson([value["source"], value["target"]])}`;
    }
  }
  return `value:${canonicalJson(value)}`;
}

function members(values: readonly unknown[]): Map<string, unknown> {
  const result = new Map<string, unknown>();
  for (const value of values) {
    const identity = memberIdentity(value);
    const prior = result.get(identity);
    if (prior !== undefined && canonicalJson(prior) !== canonicalJson(value)) {
      throw new TypeError(`Set contains duplicate normalized member ${identity}`);
    }
    result.set(identity, structuredClone(value));
  }
  return result;
}

function sameMember(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalJson(left) === canonicalJson(right);
}

/** Combines normalized set deltas and reports an add/remove opposition. */
export function mergeSetValues(
  baseValues: readonly unknown[],
  oursValues: readonly unknown[],
  theirsValues: readonly unknown[],
): SetMergeResult {
  const base = members(baseValues);
  const ours = members(oursValues);
  const theirs = members(theirsValues);
  const merged = new Map<string, unknown>();
  let opposed = false;
  const identities = new Set([...base.keys(), ...ours.keys(), ...theirs.keys()]);
  for (const identity of identities) {
    const baseValue = base.get(identity);
    const oursValue = ours.get(identity);
    const theirsValue = theirs.get(identity);
    const oursChanged = !sameMember(baseValue, oursValue);
    const theirsChanged = !sameMember(baseValue, theirsValue);
    let selected: unknown;
    if (!oursChanged) selected = theirsValue;
    else if (!theirsChanged || sameMember(oursValue, theirsValue)) selected = oursValue;
    else {
      opposed = true;
      selected = oursValue;
    }
    if (selected !== undefined) merged.set(identity, structuredClone(selected));
  }
  return {
    merged: [...merged.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, value]) => structuredClone(value)),
    opposed,
  };
}

/** Reads a value and its presence at an RFC 6901 JSON pointer. */
export function readPointer(value: unknown, path: string): SemanticNode {
  let current = value;
  if (path === "") return { present: value !== undefined, value };
  for (const segment of pointerSegments(path)) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(segment)) return { present: false, value: undefined };
      const index = Number(segment);
      if (index >= current.length) return { present: false, value: undefined };
      current = current[index];
      continue;
    }
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      return { present: false, value: undefined };
    }
    current = current[segment];
  }
  return { present: true, value: current };
}

/** Returns a cloned semantic value with one JSON-pointer value set or removed. */
export function writePointer(root: unknown, path: string, next: SemanticNode): unknown {
  if (path === "") return next.present ? structuredClone(next.value) : undefined;
  const segments = pointerSegments(path);
  const copy: unknown = root === undefined ? {} : structuredClone(root);
  let current = copy;
  for (const [index, segment] of segments.entries()) {
    const last = index === segments.length - 1;
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(segment)) {
        throw new TypeError(`JSON pointer does not address an array index: ${path}`);
      }
      const position = Number(segment);
      if (last) {
        if (next.present) current[position] = structuredClone(next.value);
        else current.splice(position, 1);
        return copy;
      }
      const child = current[position];
      if (child === null || typeof child !== "object") current[position] = {};
      current = current[position];
      continue;
    }
    if (!isRecord(current)) throw new TypeError(`JSON pointer crosses a scalar value: ${path}`);
    if (last) {
      if (next.present) current[segment] = structuredClone(next.value);
      else delete current[segment];
      return copy;
    }
    const child = current[segment];
    if (child === null || typeof child !== "object") current[segment] = {};
    current = current[segment];
  }
  return copy;
}
