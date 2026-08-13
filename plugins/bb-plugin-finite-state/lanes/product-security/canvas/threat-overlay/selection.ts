import type { ThreatSummary } from "./aggregate.js";

export interface ThreatSelection {
  threatSlug: string | null;
  targetSlug: string | null;
  routeSignature: string | null;
}

export interface ThreatSelectionState {
  selection: ThreatSelection;
  highlightedTargetSlugs: string[];
}

export type ThreatSelectionAction =
  | { type: "graph"; targetSlug: string | null }
  | { type: "threat"; threat: ThreatSummary }
  | {
      type: "path";
      routeSignature: string;
      highlightedSlugs: readonly string[];
    }
  | {
      type: "reconcile";
      threats: readonly ThreatSummary[];
      routeSignatures: ReadonlySet<string>;
    }
  | { type: "clear-path" };

export const EMPTY_THREAT_SELECTION: ThreatSelectionState = {
  selection: {
    threatSlug: null,
    targetSlug: null,
    routeSignature: null,
  },
  highlightedTargetSlugs: [],
};

export function threatSelectionKey(slugs: readonly string[]): string {
  return [...slugs].sort().join("|");
}

export function reduceThreatSelection(
  current: ThreatSelectionState,
  action: ThreatSelectionAction,
): ThreatSelectionState {
  switch (action.type) {
    case "graph": {
      const highlightedTargetSlugs = action.targetSlug
        ? [action.targetSlug]
        : [];
      if (
        current.selection.threatSlug === null &&
        current.selection.targetSlug === action.targetSlug &&
        current.selection.routeSignature === null &&
        threatSelectionKey(current.highlightedTargetSlugs) ===
          threatSelectionKey(highlightedTargetSlugs)
      ) {
        return current;
      }
      return {
        selection: {
          threatSlug: null,
          targetSlug: action.targetSlug,
          routeSignature: null,
        },
        highlightedTargetSlugs,
      };
    }
    case "threat": {
      const highlightedTargetSlugs = [...new Set(action.threat.targetSlugs)];
      if (
        current.selection.threatSlug === action.threat.slug &&
        current.selection.targetSlug === null &&
        current.selection.routeSignature === null &&
        threatSelectionKey(current.highlightedTargetSlugs) ===
          threatSelectionKey(highlightedTargetSlugs)
      ) {
        return current;
      }
      return {
        selection: {
          threatSlug: action.threat.slug,
          targetSlug: null,
          routeSignature: null,
        },
        highlightedTargetSlugs,
      };
    }
    case "path": {
      const highlightedTargetSlugs = [...new Set(action.highlightedSlugs)];
      if (
        current.selection.routeSignature === action.routeSignature &&
        threatSelectionKey(current.highlightedTargetSlugs) ===
          threatSelectionKey(highlightedTargetSlugs)
      ) {
        return current;
      }
      return {
        selection: {
          ...current.selection,
          routeSignature: action.routeSignature,
        },
        highlightedTargetSlugs,
      };
    }
    case "clear-path":
      if (current.selection.routeSignature === null) return current;
      return {
        ...current,
        selection: { ...current.selection, routeSignature: null },
      };
    case "reconcile": {
      const selectedThreat = action.threats.find(
        (threat) => threat.slug === current.selection.threatSlug,
      );
      if (!selectedThreat) {
        return current.selection.targetSlug ? current : EMPTY_THREAT_SELECTION;
      }
      const routeSignature =
        current.selection.routeSignature &&
        action.routeSignatures.has(current.selection.routeSignature)
          ? current.selection.routeSignature
          : null;
      const highlightedTargetSlugs = routeSignature
        ? current.highlightedTargetSlugs
        : [...new Set(selectedThreat.targetSlugs)];
      if (
        current.selection.threatSlug === selectedThreat.slug &&
        current.selection.targetSlug === null &&
        current.selection.routeSignature === routeSignature &&
        threatSelectionKey(current.highlightedTargetSlugs) ===
          threatSelectionKey(highlightedTargetSlugs)
      ) {
        return current;
      }
      return {
        selection: {
          threatSlug: selectedThreat.slug,
          targetSlug: null,
          routeSignature,
        },
        highlightedTargetSlugs,
      };
    }
  }
}

export function threatSlugFromPathname(pathname: string): string | null {
  const match = /(?:^|\/)tara\/threats\/([^/]+)(?:\/|$)/u.exec(pathname);
  if (!match?.[1]) return null;
  try {
    const slug = decodeURIComponent(match[1]);
    return slug.length > 0 ? slug : null;
  } catch {
    return null;
  }
}

export function threatFocusSubPath(threatSlug: string): string {
  return `tara/threats/${encodeURIComponent(threatSlug)}`;
}
