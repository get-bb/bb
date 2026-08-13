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
  | { type: "path"; routeSignature: string; highlightedSlugs: readonly string[] }
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

export function reduceThreatSelection(
  current: ThreatSelectionState,
  action: ThreatSelectionAction,
): ThreatSelectionState {
  switch (action.type) {
    case "graph":
      return {
        selection: {
          threatSlug: null,
          targetSlug: action.targetSlug,
          routeSignature: null,
        },
        highlightedTargetSlugs: action.targetSlug ? [action.targetSlug] : [],
      };
    case "threat":
      return {
        selection: {
          threatSlug: action.threat.slug,
          targetSlug: null,
          routeSignature: null,
        },
        highlightedTargetSlugs: [...new Set(action.threat.targetSlugs)],
      };
    case "path":
      return {
        selection: {
          ...current.selection,
          routeSignature: action.routeSignature,
        },
        highlightedTargetSlugs: [...new Set(action.highlightedSlugs)],
      };
    case "clear-path":
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
      return {
        selection: {
          threatSlug: selectedThreat.slug,
          targetSlug: null,
          routeSignature,
        },
        highlightedTargetSlugs: routeSignature
          ? current.highlightedTargetSlugs
          : [...new Set(selectedThreat.targetSlugs)],
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
