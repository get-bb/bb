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

export interface MarkdownLocalFileLinkRouting {
  absoluteLinks: MarkdownAbsoluteLocalFileLinkRouting;
  onOpenLink: MarkdownPreviewLocalFileLinkHandler;
  relativeLinks?: MarkdownRelativeLocalFileLinkRouting;
  /**
   * Viewer choices for the right-click menu on a local file link (e.g.
   * "Open with built-in preview" / plugin file openers). Null/empty = no
   * menu; left-click behavior is unchanged either way.
   */
  getOpenWithItems?: (
    link: MarkdownPreviewLocalFileLink,
  ) => MarkdownLocalFileOpenWithItem[] | null;
}

export interface MarkdownLinkRouting {
  localFile?: MarkdownLocalFileLinkRouting;
  onOpenLink?: MarkdownPreviewLinkHandler;
}
