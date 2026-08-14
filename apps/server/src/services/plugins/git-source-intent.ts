import type { InstalledPluginRow, PluginGitSelector } from "@bb/db";

/**
 * What a persisted git row tracks. A row carries either the ref pair or the
 * range trio; anything else is corrupt normalized state, which the callers
 * report rather than guess around.
 */
export function gitSelectorForRow(
  row: InstalledPluginRow,
): PluginGitSelector | null {
  const hasAnyRef =
    row.sourceGitRequestedRef !== null || row.sourceGitRefKind !== null;
  const hasAnyRange =
    row.sourceGitRange !== null ||
    row.sourceGitTagPrefix !== null ||
    row.sourceGitResolvedTag !== null;

  if (row.sourceKind !== "git") {
    if (hasAnyRef || hasAnyRange) {
      throw new Error(
        `plugin "${row.id}" has git selector columns on a ${row.sourceKind} row`,
      );
    }
    return null;
  }
  if (
    row.sourceGitRequestedRef !== null &&
    row.sourceGitRefKind !== null &&
    !hasAnyRange
  ) {
    return {
      kind: "ref",
      ref: row.sourceGitRequestedRef,
      refKind: row.sourceGitRefKind,
    };
  }
  if (
    row.sourceGitRange !== null &&
    row.sourceGitTagPrefix !== null &&
    row.sourceGitResolvedTag !== null &&
    !hasAnyRef
  ) {
    return {
      kind: "range",
      range: row.sourceGitRange,
      tagPrefix: row.sourceGitTagPrefix,
      resolvedTag: row.sourceGitResolvedTag,
    };
  }
  // Phase 1 rows can have a requested ref but no network classification yet.
  if (
    row.sourceGitRequestedRef !== null &&
    row.sourceGitRefKind === null &&
    !hasAnyRange
  ) {
    return null;
  }
  throw new Error(`plugin "${row.id}" has corrupt normalized git selector`);
}

/**
 * The ref name a git row resolved through — the tag for a range install.
 * Tolerates a row whose ref was persisted before bb classified refs, because
 * display must not depend on a network round trip.
 */
export function gitRefNameForRow(row: InstalledPluginRow): string | null {
  return row.sourceGitResolvedTag ?? row.sourceGitRequestedRef;
}

/** The ref name a selector resolved through: the tag, for a range install. */
export function gitSelectorRefName(selector: PluginGitSelector): string {
  return selector.kind === "ref" ? selector.ref : selector.resolvedTag;
}
