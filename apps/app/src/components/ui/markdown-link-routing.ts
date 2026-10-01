import { createContext, type ReactNode } from "react";
import type { WorkspaceOpenTarget } from "@bb/host-daemon-contract";
import type { MarkdownPreviewLinkHandler } from "./markdown-link.js";
import type {
  MarkdownAbsoluteLocalFileLinkRouting,
  MarkdownPreviewLocalFileLink,
  MarkdownPreviewLocalFileLinkHandler,
  MarkdownRelativeLocalFileLinkRouting,
} from "./markdown-local-file-link.js";

interface MarkdownLocalFileContextMenuAction {
  id: string;
  label: ReactNode;
  onSelect: () => void;
  type?: "action";
}

interface MarkdownLocalFileContextMenuSeparator {
  id: string;
  type: "separator";
}

type MarkdownLocalFileContextMenuLeafItem =
  | MarkdownLocalFileContextMenuAction
  | MarkdownLocalFileContextMenuSeparator;

interface MarkdownLocalFileContextMenuSubmenu {
  id: string;
  items: MarkdownLocalFileContextMenuLeafItem[];
  label: ReactNode;
  type: "submenu";
}

export type MarkdownLocalFileContextMenuItem =
  | MarkdownLocalFileContextMenuLeafItem
  | MarkdownLocalFileContextMenuSubmenu;

type MarkdownLocalFileContextMenuItemsProvider = (
  link: MarkdownPreviewLocalFileLink,
) => MarkdownLocalFileContextMenuItem[] | null;

export const MarkdownLocalFileContextMenuContext =
  createContext<MarkdownLocalFileContextMenuItemsProvider | null>(null);

export const MarkdownLocalFileOpenTargetsContext = createContext<
  readonly WorkspaceOpenTarget[]
>([]);

export interface MarkdownLocalFileLinkRouting {
  absoluteLinks: MarkdownAbsoluteLocalFileLinkRouting;
  onOpenLink: MarkdownPreviewLocalFileLinkHandler;
  relativeLinks?: MarkdownRelativeLocalFileLinkRouting;
}

export interface MarkdownLocalImageRouting {
  absolutePaths: MarkdownAbsoluteLocalFileLinkRouting;
  relativePaths?: MarkdownRelativeLocalFileLinkRouting;
  resolveSrc: (
    image: MarkdownPreviewLocalFileLink,
    sourceKind: "absolute" | "relative",
  ) => string;
}

export interface MarkdownLinkRouting {
  localFile?: MarkdownLocalFileLinkRouting;
  localImage?: MarkdownLocalImageRouting;
  onOpenLink?: MarkdownPreviewLinkHandler;
}
