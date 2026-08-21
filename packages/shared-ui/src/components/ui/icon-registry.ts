import type { IconSvgElement } from "@hugeicons/react";

/**
 * Names of the glyphs that live in the lazily loaded extended registry
 * (`./icon-extended`). Only this list of strings is on the boot path; the
 * artwork itself loads with the first route that renders one of these icons
 * or, as a fallback, on first request from `Icon`.
 *
 * `./icon-extended` must map every name here and nothing else; the compiler
 * enforces that through `Record<ExtendedIconName, IconSvgElement>`.
 */
export const EXTENDED_ICON_NAMES = [
  "AiContentGenerator01",
  "AlignLeft",
  "AppWindow",
  "ArchiveRestore",
  "ArrowDown",
  "ArrowRight",
  "ArrowReloadHorizontal",
  "ArrowUp",
  "ArrowUpDown",
  "ArrowTurnBackward",
  "ArrowTurnForward",
  "ArrowUpRight",
  "Beaker",
  "Browser",
  "Brain",
  "Calendar",
  "CalendarCheckOut02",
  "ChartColumn",
  "ChevronUp",
  "ChevronsDown",
  "ChevronsUp",
  "CircleArrowShrink",
  "Clean",
  "Clock",
  "Cloud",
  "CloudOff",
  "Coffee",
  "Columns2",
  "CornerDownLeft",
  "CornerDownRight",
  "Discord",
  "DateTime",
  "Github",
  "DragDropHorizontal",
  "DragDropVertical",
  "EditFile",
  "ElectricPlugs",
  "Eye",
  "EyeOff",
  "Explore",
  "ExternalLink",
  "FileDiff",
  "File",
  "FileAttachment",
  "FileQuestion",
  "FileText",
  "FolderOpen",
  "FolderEdit",
  "FolderMinus",
  "Fork",
  "GitBranch",
  "GitMerge",
  "GitPullRequest",
  "GitPullRequestArrow",
  "GitPullRequestClosed",
  "GitPullRequestDraft",
  "Globe",
  "GridView",
  "Laptop",
  "Layers",
  "ListView",
  "Lock",
  "Mail",
  "MailOpen",
  "Maximize2",
  "Mic",
  "Minimize2",
  "NewTab",
  "PackageReceive",
  "Palette",
  "PanelBottom",
  "PanelRight",
  "Paperclip",
  "Pause",
  "Pin",
  "PinOff",
  "Play",
  "Plus",
  "Puzzle",
  "Repeat",
  "RotateCcw",
  "Rows2",
  "SecurityCheck",
  "Sent",
  "SideChat",
  "Smartphone",
  "Sort",
  "Square",
  "SquareUnlock02",
  "Star",
  "TextWrap",
  "TimeSchedule",
  "UserRound",
  "ZoomIn",
  "ZoomOut",
] as const;

export type ExtendedIconName = (typeof EXTENDED_ICON_NAMES)[number];

export type ExtendedIconMap = Readonly<
  Record<ExtendedIconName, IconSvgElement>
>;

let extendedIcons: ExtendedIconMap | null = null;
const listeners = new Set<() => void>();

/**
 * Publishes the extended glyph map. Called by `./icon-extended` when it
 * evaluates, so any chunk that statically imports that module makes every
 * extended icon render synchronously; `Icon` instances that were showing a
 * placeholder re-render through {@link subscribeExtendedIcons}.
 */
export function registerExtendedIcons(map: ExtendedIconMap): void {
  if (extendedIcons === map) return;
  extendedIcons = map;
  for (const listener of listeners) listener();
}

/** The extended glyph map, or null until `./icon-extended` has evaluated. */
export function getExtendedIcons(): ExtendedIconMap | null {
  return extendedIcons;
}

/** `useSyncExternalStore`-shaped subscription to {@link getExtendedIcons}. */
export function subscribeExtendedIcons(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
