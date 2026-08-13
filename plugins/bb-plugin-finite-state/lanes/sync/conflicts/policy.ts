import type { EntityKind } from "../../../lib/sync/registry.js";
import type { ConflictAttribution, FieldConflict } from "./detect.js";

export interface ConflictPolicy {
  kind: EntityKind;
  setPaths: readonly string[];
  neverAutoMergePaths: readonly string[];
  suggest(conflict: FieldConflict): "take-ours" | "take-theirs" | null;
}

const policies = new Map<EntityKind, ConflictPolicy>();

function assertPointer(path: string): void {
  if (path !== "" && !path.startsWith("/")) {
    throw new TypeError(`Conflict policy path must be an RFC 6901 JSON pointer: ${path}`);
  }
  for (const segment of path.split("/").slice(1)) {
    if (/~(?![01])/u.test(segment)) {
      throw new TypeError(`Conflict policy path has an invalid RFC 6901 escape: ${path}`);
    }
  }
}

/** Installs or replaces the conflict policy owned by one semantic surface. */
export function registerConflictPolicy(policy: ConflictPolicy): void {
  for (const path of [...policy.setPaths, ...policy.neverAutoMergePaths]) {
    assertPointer(path);
  }
  policies.set(policy.kind, Object.freeze({
    ...policy,
    setPaths: Object.freeze([...new Set(policy.setPaths)]),
    neverAutoMergePaths: Object.freeze([...new Set(policy.neverAutoMergePaths)]),
  }));
}

/** Returns the registered policy or a conservative no-merge/no-suggestion fallback. */
export function conflictPolicy(kind: EntityKind): ConflictPolicy {
  return policies.get(kind) ?? {
    kind,
    setPaths: [],
    neverAutoMergePaths: [],
    suggest: () => null,
  };
}

/**
 * A provider may positively classify a human edit with `source: "human"`.
 * Any other source remains neutral until the production audit vocabulary is
 * verified; actor labels alone are never treated as proof of a human.
 */
export function isPositivelyHuman(attribution: ConflictAttribution): boolean {
  return attribution.available
    && attribution.actor !== null
    && attribution.actor.trim().length > 0
    && attribution.source?.toLocaleLowerCase("en-US") === "human";
}

registerConflictPolicy({
  kind: "vexDecision",
  setPaths: [],
  neverAutoMergePaths: ["/status", "/justification", "/response", "/reason"],
  suggest: (conflict) => isPositivelyHuman(conflict.attribution) ? "take-theirs" : null,
});

registerConflictPolicy({
  kind: "attackPath",
  setPaths: ["/nodes", "/edges"],
  neverAutoMergePaths: [],
  suggest: () => null,
});
