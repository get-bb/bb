import type { EntityKind } from "../../../lib/sync/registry.js";
import { canonicalJson } from "../serialize/canonical.js";
import {
  mergeSetValues,
  pointerChild,
  sameSemanticNode,
  type SemanticNode,
} from "./merge.js";
import { conflictPolicy } from "./policy.js";

export interface ConflictAttribution {
  actor: string | null;
  at: string | null;
  source: string | null;
  available: boolean;
}

export interface FieldConflict {
  kind: EntityKind;
  key: string;
  path: string;
  base: unknown;
  ours: unknown;
  theirs: unknown;
  classification: "same-field" | "delete-update" | "create-create" | "set-opposed" | "type-change";
  attribution: ConflictAttribution;
  suggestion: "take-ours" | "take-theirs" | null;
  resolution: {
    choice: "take-ours" | "take-theirs" | "edited";
    value?: unknown;
    resolvedBy: string;
    resolvedAt: string;
  } | null;
}

interface DetectState {
  kind: EntityKind;
  key: string;
  setPaths: ReadonlySet<string>;
  forbiddenPaths: ReadonlySet<string>;
  conflicts: FieldConflict[];
}

const UNAVAILABLE_ATTRIBUTION: ConflictAttribution = Object.freeze({
  actor: null,
  at: null,
  source: null,
  available: false,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function node(value: unknown, present = value !== undefined): SemanticNode {
  return { present, value: present ? value : undefined };
}

function child(parent: SemanticNode, key: string): SemanticNode {
  if (!parent.present || !isRecord(parent.value) || !Object.hasOwn(parent.value, key)) {
    return node(undefined, false);
  }
  return node(parent.value[key], true);
}

function valueType(value: unknown): "null" | "array" | "object" | "scalar" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  return "scalar";
}

function classification(base: SemanticNode, ours: SemanticNode, theirs: SemanticNode): FieldConflict["classification"] {
  if (!base.present && ours.present && theirs.present) return "create-create";
  if (base.present && ours.present !== theirs.present) return "delete-update";
  if (
    ours.present
    && theirs.present
    && (valueType(ours.value) !== valueType(theirs.value)
      || (base.present && valueType(base.value) !== valueType(ours.value))
      || (base.present && valueType(base.value) !== valueType(theirs.value)))
  ) {
    return "type-change";
  }
  return "same-field";
}

function conflict(
  state: DetectState,
  path: string,
  base: SemanticNode,
  ours: SemanticNode,
  theirs: SemanticNode,
  forced?: FieldConflict["classification"],
): void {
  state.conflicts.push({
    kind: state.kind,
    key: state.key,
    path,
    base: base.present ? structuredClone(base.value) : undefined,
    ours: ours.present ? structuredClone(ours.value) : undefined,
    theirs: theirs.present ? structuredClone(theirs.value) : undefined,
    classification: forced ?? classification(base, ours, theirs),
    attribution: UNAVAILABLE_ATTRIBUTION,
    suggestion: null,
    resolution: null,
  });
}

function mergeNode(
  state: DetectState,
  path: string,
  base: SemanticNode,
  ours: SemanticNode,
  theirs: SemanticNode,
): SemanticNode {
  const oursChanged = !sameSemanticNode(base, ours);
  const theirsChanged = !sameSemanticNode(base, theirs);
  if (!oursChanged) return theirs;
  if (!theirsChanged) return ours;
  if (sameSemanticNode(ours, theirs)) return ours;

  if (state.forbiddenPaths.has(path)) {
    conflict(state, path, base, ours, theirs);
    return ours;
  }
  if (
    state.setPaths.has(path)
    && ours.present
    && theirs.present
    && (!base.present || Array.isArray(base.value))
    && Array.isArray(ours.value)
    && Array.isArray(theirs.value)
  ) {
    const baseSet = Array.isArray(base.value) ? base.value : [];
    const merged = mergeSetValues(baseSet, ours.value, theirs.value);
    if (merged.opposed) {
      conflict(state, path, base, ours, theirs, "set-opposed");
      return ours;
    }
    return node(merged.merged);
  }
  if (base.present && ours.present && theirs.present
    && isRecord(base.value) && isRecord(ours.value) && isRecord(theirs.value)) {
    const result: Record<string, unknown> = {};
    const keys = new Set([
      ...Object.keys(base.value),
      ...Object.keys(ours.value),
      ...Object.keys(theirs.value),
    ]);
    for (const key of [...keys].sort((left, right) => left.localeCompare(right))) {
      const merged = mergeNode(
        state,
        pointerChild(path, key),
        child(base, key),
        child(ours, key),
        child(theirs, key),
      );
      if (merged.present) result[key] = structuredClone(merged.value);
    }
    return node(result);
  }

  conflict(state, path, base, ours, theirs);
  return ours;
}

/** Refines one semantic three-way candidate into pointer-addressed conflicts. */
export function detectConflicts(input: {
  kind: EntityKind;
  key: string;
  base: unknown;
  ours: unknown;
  theirs: unknown;
}): { merged: unknown; conflicts: FieldConflict[] } {
  for (const value of [input.base, input.ours, input.theirs]) {
    if (value !== undefined) canonicalJson(value);
  }
  const policy = conflictPolicy(input.kind);
  const state: DetectState = {
    kind: input.kind,
    key: input.key,
    setPaths: new Set(policy.setPaths),
    forbiddenPaths: new Set(policy.neverAutoMergePaths),
    conflicts: [],
  };
  const merged = mergeNode(
    state,
    "",
    node(input.base),
    node(input.ours),
    node(input.theirs),
  );
  return {
    merged: merged.present ? structuredClone(merged.value) : undefined,
    conflicts: state.conflicts,
  };
}
