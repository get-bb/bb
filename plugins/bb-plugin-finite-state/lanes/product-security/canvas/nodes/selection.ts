import { createContext, useContext } from "react";
import type {
  ArchitectureAdjacency,
  ArchitectureEdgeData,
  ArchitectureNodeData,
  CanvasArchitectureGraph,
  UnresolvedRef,
} from "./adapters.js";

export type ArchitectureSelectionKind = "node" | "edge";

export interface ArchitectureContextMenuState {
  targetId: string;
  targetKind: ArchitectureSelectionKind;
  x: number;
  y: number;
}

export interface ArchitectureSelectionContextValue {
  graph: CanvasArchitectureGraph;
  nodesBySlug: ReadonlyMap<string, ArchitectureNodeData>;
  edgesBySlug: ReadonlyMap<string, ArchitectureEdgeData>;
  adjacency: ReadonlyMap<string, ArchitectureAdjacency>;
  unresolved: readonly UnresolvedRef[];
  selectedIds: readonly string[];
  focusId: string | null;
  coordinatorId: string | null;
  menu: ArchitectureContextMenuState | null;
  setSelectedIds(ids: readonly string[]): void;
  setFitSelection(callback: (() => void) | null): void;
  fitSelection(): void;
  openMenu(menu: ArchitectureContextMenuState): void;
  closeMenu(): void;
  onFocusRoute(kind: ArchitectureSelectionKind, slug: string): void;
}

export const ArchitectureSelectionContext =
  createContext<ArchitectureSelectionContextValue | null>(null);

export function useArchitectureSelection(): ArchitectureSelectionContextValue {
  const context = useContext(ArchitectureSelectionContext);
  if (!context) {
    throw new Error(
      "Architecture canvas controls require their workspace provider.",
    );
  }
  return context;
}

export function useOptionalArchitectureSelection(): ArchitectureSelectionContextValue | null {
  return useContext(ArchitectureSelectionContext);
}

export function focusIdFromRoute(detail: readonly string[]): string | null {
  if (detail.length < 2) return null;
  if (detail[0] !== "nodes" && detail[0] !== "dataflows") return null;
  return detail[1] ?? null;
}

export function focusSubPath(
  kind: ArchitectureSelectionKind,
  slug: string,
): string {
  return `tara/${kind === "edge" ? "dataflows" : "nodes"}/${encodeURIComponent(slug)}`;
}

export const wp35MutationStubs = {
  create(): void {
    // WP-35 owns architecture writes. This shell deliberately has no behavior.
  },
  duplicate(): void {
    // WP-35 owns architecture writes. This shell deliberately has no behavior.
  },
  remove(): void {
    // WP-35 owns architecture writes. This shell deliberately has no behavior.
  },
};
