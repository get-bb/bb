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

/**
 * Fork the active thread. A native fork clones the parent's provider session at
 * its branch point (the whole conversation), so it takes no per-message anchor —
 * the action lives on agent rows for discoverability, but every row forks the
 * same session. Supplied by the timeline host (which owns the source thread +
 * environment).
 */
export type ThreadTimelineForkMessageHandler = () => void;

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

export interface ThreadTimelineSendToMainMessageTarget {
  /** Visible text of the side-chat agent message to hand back to the main thread. */
  messageText: string;
}

/**
 * Hand a specific side-chat agent message back to the main thread. Supplied only
 * by the side-chat timeline host; the per-message action bar invokes it with the
 * row's text. Absent on the main timeline — a main-thread message has no "main
 * thread" to send to.
 */
export type ThreadTimelineSendToMainMessageHandler = (
  target: ThreadTimelineSendToMainMessageTarget,
) => void;

/**
 * Append selected agent-message text to the active thread's prompt draft as a
 * `> `-prefixed blockquote block ("Add to chat"). The editor renders it as a
 * blockquote and the user types a reply beneath it. Supplied by the timeline
 * host (which owns the composer draft); the floating selection menu invokes it
 * with the selected text. Absent when no composer draft is available.
 */
export type ThreadTimelineSelectionAddToChatHandler = (text: string) => void;

/**
 * Open a side chat anchored on the selected agent-message text ("Reply in side
 * chat"). Distinct from the per-message Reply handler only in that the anchor is
 * the *selection*, not the whole message; both ultimately open a side chat off
 * the active thread. Supplied by the timeline host; absent when side chats are
 * unavailable.
 */
export type ThreadTimelineSelectionReplyInSideChatHandler = (
  text: string,
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
