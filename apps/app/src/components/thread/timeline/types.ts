import type { ThreadChatMessageReference } from "@get-bb/plugin-sdk";
import type { PromptInput } from "@bb/domain";
import type {
  MarkdownPreviewLocalFileLink,
  MarkdownPreviewLocalFileLinkHandler,
} from "../../ui/markdown-local-file-link.js";
import type { MarkdownPreviewLinkHandler } from "../../ui/markdown-link.js";
import type { PromptDraftAttachment } from "@/lib/prompt-draft";
import type { MarkdownMessageDirectiveOpenThreadPanel } from "@/components/ui/markdown-message-directives";

export type ThreadTimelineTheme = "light" | "dark";

export type ThreadTimelineLocalFileLink = MarkdownPreviewLocalFileLink;

export type ThreadTimelineLocalFileLinkHandler =
  MarkdownPreviewLocalFileLinkHandler;

export type ThreadTimelineLinkHandler = MarkdownPreviewLinkHandler;

export type ThreadTimelineOpenPluginPanelHandler =
  MarkdownMessageDirectiveOpenThreadPanel;

export interface ThreadTimelineForkMessageTarget {
  /** Last source event sequence included in the provider-history fork. */
  sourceSeqEnd: number;
}

/**
 * Fork the active thread at the clicked agent row. Supplied by the timeline host
 * (which owns the source thread + environment); the row supplies its source
 * sequence so the server can clone provider history at that branch point.
 */
export type ThreadTimelineForkMessageHandler = (
  target: ThreadTimelineForkMessageTarget,
) => void;

export interface ThreadTimelineEditMessageTarget {
  /** Stable id of the specific rendered user bubble being edited. */
  messageId: string;
  /** Event sequence of the user request the edit would replace. */
  expectedRequestSequence: number;
  /** User-visible input reconstructed from the unchanged timeline row. */
  input: PromptInput[];
}

/**
 * Start a client-local edit session for an eligible user request.
 * Supplying this handler only enables the affordance; the row never mutates
 * thread or provider state itself.
 */
export type ThreadTimelineEditMessageHandler = (
  target: ThreadTimelineEditMessageTarget,
) => void;

/** Client-local editor mounted in place of one user conversation row. */
export interface ThreadTimelineInlineMessageEditor {
  messageId: string;
  onHostElementChange: (element: HTMLDivElement | null) => void;
}

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
 * Append agent-message text or a selected excerpt to the active thread's prompt
 * draft as a `> `-prefixed blockquote block ("Add to chat"). The editor renders
 * it as a blockquote and the user types a reply beneath it. Supplied by the
 * timeline host, which owns the composer draft. Absent when no composer draft
 * is available.
 */
export type ThreadTimelineAddToChatHandler = (
  text: string,
  attachments?: readonly PromptDraftAttachment[],
) => void;

/**
 * A plugin-contributed per-message action, resolved by the timeline root
 * (which owns the slot subscription and the invocation context) and rendered
 * by the per-message action bar / selection menu as host chrome.
 */
export interface ThreadTimelinePluginMessageAction {
  /** Unique render key across plugins and reload generations. */
  key: string;
  /** Plugin whose branding icon labels the action; null renders `icon` alone. */
  pluginId: string | null;
  /** Icon hint (BB icon name) or null for the plugin's generic icon. */
  icon: string | null;
  label: string;
  onSelect: () => void;
}

/**
 * A consumer-supplied per-message action scoped to one embedded chat surface
 * (the `ThreadChat` `messageActions` prop), rendered in the per-message
 * action bar after the slot-registered plugin actions. Invocation errors are
 * contained by the timeline; `run` can never break it.
 */
export interface ThreadTimelineConsumerMessageAction {
  /** Unique within the surface's action list. */
  id: string;
  /** Plugin whose branding icon labels the action, when known. */
  pluginId: string | null;
  /** Icon hint (BB icon name) or null for a generic icon. */
  icon: string | null;
  label: string;
  /** Message roles the action applies to. Omitted = both roles. */
  roles?: readonly ("user" | "assistant")[];
  run(message: ThreadChatMessageReference): void | Promise<void>;
}

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
