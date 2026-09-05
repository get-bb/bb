import type { MarkdownProps } from "@get-bb/plugin-sdk";
import { createContext, type ReactNode } from "react";
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

export function isMarkdownLocalFileHref(href: string): boolean {
  return (
    href.length > 0 &&
    !href.startsWith("#") &&
    !href.startsWith("//") &&
    (/^file:/iu.test(href) ||
      /^[a-z]:[\\/]/iu.test(href) ||
      !/^[a-z][a-z0-9+.-]*:/iu.test(href))
  );
}

export interface MarkdownLinkRouting {
  resolveFileLink?: MarkdownProps["experimental_resolveFileLink"];
  localFile?: MarkdownLocalFileLinkRouting;
  localImage?: MarkdownLocalImageRouting;
  onOpenLink?: MarkdownPreviewLinkHandler;
}
