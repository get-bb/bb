import { createContext, type ReactNode } from "react";
import type { MarkdownPreviewLinkHandler } from "./markdown-link.js";
import type {
  MarkdownAbsoluteLocalFileLinkRouting,
  MarkdownPreviewLocalFileLink,
  MarkdownPreviewLocalFileLinkHandler,
  MarkdownRelativeLocalFileLinkRouting,
} from "./markdown-local-file-link.js";

/** One action in a local file link's right-click menu. */
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

/**
 * Right-click menu items for local file links. Null/empty = no menu; left-click
 * behavior is unchanged either way.
 */
type MarkdownLocalFileContextMenuItemsProvider = (
  link: MarkdownPreviewLocalFileLink,
) => MarkdownLocalFileContextMenuItem[] | null;

/**
 * Context, not a routing field: local file links render across the thread
 * timeline and every file-preview surface, whose link routings are built in
 * many places — one provider at the view root covers them all uniformly.
 */
export const MarkdownLocalFileContextMenuContext =
  createContext<MarkdownLocalFileContextMenuItemsProvider | null>(null);

export interface MarkdownLocalFileLinkRouting {
  absoluteLinks: MarkdownAbsoluteLocalFileLinkRouting;
  onOpenLink: MarkdownPreviewLocalFileLinkHandler;
  relativeLinks?: MarkdownRelativeLocalFileLinkRouting;
}

export interface MarkdownLocalImageRouting {
  absolutePaths: MarkdownAbsoluteLocalFileLinkRouting;
  relativePaths?: MarkdownRelativeLocalFileLinkRouting;
  resolveSrc: (image: MarkdownPreviewLocalFileLink) => string;
}

export interface MarkdownLinkRouting {
  localFile?: MarkdownLocalFileLinkRouting;
  localImage?: MarkdownLocalImageRouting;
  onOpenLink?: MarkdownPreviewLinkHandler;
}
