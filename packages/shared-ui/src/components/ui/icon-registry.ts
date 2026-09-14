import type { ComponentType } from "react";
import type { IconSvgElement } from "@hugeicons/react";

export const EXTENDED_ICON_NAMES = [
  "AiBrain01",
  "AiBrowser",
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
  "BellDot",
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
  "DiscordLogo",
  "DateTime",
  "Github",
  "GithubLogo",
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
  "Limitation",
  "ListView",
  "Lock",
  "Mail",
  "MailOpen",
  "Maximize2",
  "Mic",
  "Minimize2",
  "MoveTo",
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
  "Plug02",
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

export function registerExtendedIcons(map: ExtendedIconMap): void {
  if (extendedIcons === map) return;
  extendedIcons = map;
  for (const listener of listeners) listener();
}

export function getExtendedIcons(): ExtendedIconMap | null {
  return extendedIcons;
}

export function subscribeExtendedIcons(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

interface AppIconDefinition {
  component: ComponentType<{ className?: string }>;
  key: string;
}

let appIcons: ReadonlyMap<string, AppIconDefinition> = new Map();
const appIconListeners = new Set<() => void>();

export function setAppIcons(
  next: ReadonlyMap<string, AppIconDefinition>,
): void {
  appIcons = next;
  for (const listener of appIconListeners) listener();
}

export function getAppIcon(name: string): AppIconDefinition | undefined {
  return appIcons.get(name);
}

export function subscribeAppIcons(listener: () => void): () => void {
  appIconListeners.add(listener);
  return () => {
    appIconListeners.delete(listener);
  };
}
