import type { ThreadListEntry } from "@bb/domain";
import { fuzzyMatchText } from "@bb/fuzzy-match";
import type { IconName } from "@bb/shared-ui/icon";
import {
  positionsToRanges,
  type HighlightRange,
} from "./palette-thread-search";

type PaletteGroupingKind = "project" | "section" | "pinned";

export interface PaletteGrouping {
  kind: PaletteGroupingKind;
  id: string;
  name: string;
  icon: IconName;
}

export interface PaletteGroupingMatch {
  grouping: PaletteGrouping;
  highlightRanges: readonly HighlightRange[];
}

export const PALETTE_GROUPING_KIND_LABELS: Record<PaletteGroupingKind, string> =
  {
    project: "Project",
    section: "Section",
    pinned: "Pinned",
  };

interface PaletteGroupingSource {
  id: string;
  name: string;
}

interface BuildPaletteGroupingsArgs {
  projects: readonly PaletteGroupingSource[];
  personalProject: PaletteGroupingSource | null;
  sections: readonly PaletteGroupingSource[];
  hasPinnedThreads: boolean;
}

export function buildPaletteGroupings({
  projects,
  personalProject,
  sections,
  hasPinnedThreads,
}: BuildPaletteGroupingsArgs): PaletteGrouping[] {
  const pinned: PaletteGrouping = {
    kind: "pinned",
    id: "pinned",
    name: "Pinned",
    icon: "Pin",
  };
  return [
    ...[
      ...projects,
      ...(personalProject === null ? [] : [personalProject]),
    ].map((project): PaletteGrouping => ({
      kind: "project",
      id: project.id,
      name: project === personalProject ? "Personal" : project.name,
      icon: "Folder",
    })),
    ...sections.map((section): PaletteGrouping => ({
      kind: "section",
      id: section.id,
      name: section.name,
      icon: "Layers",
    })),
    ...(hasPinnedThreads ? [pinned] : []),
  ];
}

export function matchPaletteGroupings(
  groupings: readonly PaletteGrouping[],
  query: string,
): PaletteGroupingMatch[] {
  if (query.trim().length === 0) return [];
  return fuzzyMatchText({
    items: groupings,
    query,
    getText: (grouping) => grouping.name,
    limit: groupings.length,
  })
    .sort((left, right) => right.score - left.score)
    .map((match) => ({
      grouping: match.item,
      highlightRanges: positionsToRanges(match.positions),
    }));
}

export function isThreadInGrouping(
  thread: Pick<ThreadListEntry, "pinnedAt" | "projectId" | "sectionId">,
  grouping: PaletteGrouping,
): boolean {
  if (grouping.kind === "project") return thread.projectId === grouping.id;
  if (grouping.kind === "section") return thread.sectionId === grouping.id;
  return thread.pinnedAt !== null;
}
