import type {
  ApprovalPendingInteractionPayload,
  PendingInteractionToolUseApprovalSubject,
  ThreadEventItemPresentationIcon,
  ThreadEventItemPresentationTint,
} from "@bb/domain";

/**
 * The tool-use ask, read from the subject's `presentation` alone
 * (docs/provider-plugin-api.md §4). A `tool_use` approval is any tool call
 * that is neither a command nor a file change — an MCP tool, a provider-native
 * tool with no core kind — so no client knows the tool by name. The bridge's
 * declarative presentation is the whole description: the same label, glyph,
 * headline and detail its timeline row renders with, so the banner and the
 * row read alike on every client.
 */
export interface PendingInteractionToolUseAsk {
  /**
   * The banner heading: the bridge's reason for asking when it gave one,
   * else the present-tense label ("Fetching URL").
   */
  title: string;
  /** The provider's tool name — the only identifier the decision names. */
  tool: string;
  /** Row headline beside the label (a path, a query, a URL), when the bridge set one. */
  headline: string | null;
  /** Short Markdown summary of the call, when the bridge set one. */
  detail: string | null;
  /** The bridge's glyph; a client falls back to its generic tool glyph when unknown. */
  icon: ThreadEventItemPresentationIcon;
  /** Accent per theme, or null for the neutral colour. */
  tint: ThreadEventItemPresentationTint | null;
}

export interface ToolUseApprovalPendingInteractionPayload extends ApprovalPendingInteractionPayload {
  subject: PendingInteractionToolUseApprovalSubject;
}

export function describePendingInteractionToolUse(
  payload: ToolUseApprovalPendingInteractionPayload,
): PendingInteractionToolUseAsk {
  const { tool, presentation } = payload.subject;
  return {
    title: payload.reason ?? presentation.label.pending,
    tool,
    // An empty headline or detail is an absent one, as the rows read it.
    headline: presentAsText(presentation.title),
    detail: presentAsText(presentation.detail),
    icon: presentation.icon,
    tint: presentation.tint ?? null,
  };
}

function presentAsText(value: string | undefined): string | null {
  return value === undefined || value.trim().length === 0 ? null : value;
}

/**
 * The plain-text lines every text surface (CLI, child-thread blocker
 * summaries) prints under the heading. The label is the heading itself, so
 * it is not repeated here.
 */
export function formatPendingInteractionToolUseDetailLines(
  ask: PendingInteractionToolUseAsk,
): string[] {
  return [
    `Tool: ${ask.tool}`,
    ...(ask.headline !== null ? [ask.headline] : []),
    ...(ask.detail !== null ? [ask.detail] : []),
  ];
}
