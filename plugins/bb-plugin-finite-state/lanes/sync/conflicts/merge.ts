import { canonicalJson } from "../serialize/canonical.js";

export interface SemanticNode {
  present: boolean;
  value: unknown;
}

export interface SetMergeResult {
  merged: unknown[];
  opposed: boolean;
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
