import { createContext } from "react";
import type { MarkdownPreviewLinkHandler } from "./markdown-link.js";
import type {
  MarkdownAbsoluteLocalFileLinkRouting,
  MarkdownPreviewLocalFileLink,
  MarkdownPreviewLocalFileLinkHandler,
  MarkdownRelativeLocalFileLinkRouting,
} from "./markdown-local-file-link.js";

/** One entry in a local file link's right-click "Open with" menu. */
export interface MarkdownLocalFileOpenWithItem {
  id: string;
  label: string;
  onSelect: () => void;
}

/**
 * Viewer choices for the right-click menu on local file links (e.g. "Open
 * with built-in preview" / plugin file openers). Null/empty = no menu;
 * left-click behavior is unchanged either way.
 */
export type MarkdownLocalFileOpenWithItemsProvider = (
  link: MarkdownPreviewLocalFileLink,
) => MarkdownLocalFileOpenWithItem[] | null;

/**
 * Context, not a routing field: local file links render across the thread
 * timeline and every file-preview surface, whose link routings are built in
 * many places — one provider at the view root covers them all uniformly.
 */
export const MarkdownLocalFileOpenWithContext =
  createContext<MarkdownLocalFileOpenWithItemsProvider | null>(null);

export interface MarkdownLocalFileLinkRouting {
  absoluteLinks: MarkdownAbsoluteLocalFileLinkRouting;
  onOpenLink: MarkdownPreviewLocalFileLinkHandler;
  relativeLinks?: MarkdownRelativeLocalFileLinkRouting;
}

export interface MarkdownLinkRouting {
  localFile?: MarkdownLocalFileLinkRouting;
  onOpenLink?: MarkdownPreviewLinkHandler;
}
