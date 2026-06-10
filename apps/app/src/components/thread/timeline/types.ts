import type {
  MarkdownPreviewLocalFileLink,
  MarkdownPreviewLocalFileLinkHandler,
} from "../../ui/markdown-local-file-link.js";
import type { MarkdownPreviewLinkHandler } from "../../ui/markdown-link.js";

export type ThreadTimelineTheme = "light" | "dark";

export type ThreadTimelineLocalFileLink = MarkdownPreviewLocalFileLink;

export type ThreadTimelineLocalFileLinkHandler =
  MarkdownPreviewLocalFileLinkHandler;

export type ThreadTimelineLinkHandler = MarkdownPreviewLinkHandler;

export interface ThreadTimelineForkMessageTarget {
  /** Visible text of the agent message the fork anchors on. */
  messageText: string;
  /** Turn the anchor message belongs to. Null for turn-less rows. */
  sourceTurnId: string | null;
}

/**
 * Fork the active thread from a specific agent message. Supplied by the
 * timeline host (which owns the source thread + environment); the per-message
 * action bar invokes it with the row's anchor identity.
 */
export type ThreadTimelineForkMessageHandler = (
  target: ThreadTimelineForkMessageTarget,
) => void;

export interface ThreadTimelineSideChatMessageTarget {
  /** Visible text of the agent message the side chat is anchored to. */
  messageText: string;
}

/**
 * Open a message-anchored side chat off the active thread. Supplied by the
 * timeline host (which owns the source thread + the secondary panel); the
 * per-message action bar invokes it with the row's anchor text.
 */
export type ThreadTimelineSideChatMessageHandler = (
  target: ThreadTimelineSideChatMessageTarget,
) => void;

export type ThreadTimelineUnreadDividerPlacement =
  | {
      kind: "after-cutoff";
      cutoffAt: number;
    }
  | {
      kind: "before-first";
    };

export type UserAttachmentImageSrcResolver = (
  pathOrUrl: string,
  projectId?: string,
) => string;

export interface ThreadTimelineImageViewSrcTarget {
  path: string;
  threadId: string;
}

export type ThreadTimelineImageViewSrcResolver = (
  target: ThreadTimelineImageViewSrcTarget,
) => string;
