import type { PromptMentionResource, PromptTextMention } from "@bb/domain";
import type { TimelineConversationTurnRequest } from "@bb/server-contract";
import type { TimelineTitleLink } from "@bb/thread-view";
import { useState, type ReactNode } from "react";
import { ConversationMessageContent } from "@/components/thread/timeline/ConversationMessageContent";
import { appendQuoteToDraftText } from "@/lib/prompt-draft";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";

export default {
  title: "thread/timeline/User Message Markdown",
};

// ThreadTimelinePane caps content at 760px; match it so the bubble reflects
// production width.
function TimelineStage({
  children,
  revealMessageActions = false,
}: {
  children: ReactNode;
  revealMessageActions?: boolean;
}) {
  return (
    <div
      className={`w-full max-w-[760px] ${
        revealMessageActions ? "[&_button]:opacity-100" : ""
      }`}
    >
      {children}
    </div>
  );
}

function resolveThreadLink(link: TimelineTitleLink): string | null {
  return link.kind === "thread"
    ? `/projects/proj_demo/threads/${link.threadId}`
    : null;
}

// File/command pills render interactive when a click action resolves; a no-op
// keeps the story self-contained while still showing the interactive style.
const resolveMentionLink = () => () => {};

function appendStoryQuote(draftText: string, quotedText: string): string {
  return appendQuoteToDraftText(
    { text: draftText, mentions: [], attachments: [] },
    quotedText,
  ).text;
}

function DraftQuotePreview({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3 py-2 text-xs text-muted-foreground">
      <div className="mb-1 font-medium text-foreground">Draft quote</div>
      <pre className="whitespace-pre-wrap font-mono">{text}</pre>
    </div>
  );
}

const acceptedMessage: TimelineConversationTurnRequest = {
  kind: "message",
  status: "accepted",
};

// Builds a mention spanning the first occurrence of `token` in `text`.
function mentionAt(
  text: string,
  token: string,
  resource: PromptMentionResource,
): PromptTextMention {
  const start = text.indexOf(token);
  return { start, end: start + token.length, resource };
}

function UserMessage({
  text,
  mentions = [],
  onAddToChat,
}: {
  text: string;
  mentions?: readonly PromptTextMention[];
  onAddToChat?: (text: string) => void;
}) {
  return (
    <TimelineStage revealMessageActions={onAddToChat !== undefined}>
      <ConversationMessageContent
        role="user"
        initiator="user"
        childOrigin={null}
        senderThreadId={null}
        senderThreadTitle={null}
        senderChildOrigin={null}
        resolveSegmentLinkHref={resolveThreadLink}
        resolveMentionLink={resolveMentionLink}
        onAddToChat={onAddToChat}
        systemMessageKind="unlabeled"
        systemMessageSubject={null}
        text={text}
        attachments={null}
        mentions={mentions}
        projectId="proj_demo"
        turnRequest={acceptedMessage}
      />
    </TimelineStage>
  );
}

const FORMATTING_BODY = [
  "# Plan for the markdown work",
  "",
  "Render user bubbles as **markdown** with _emphasis_ and `inline code`.",
  "",
  "## Steps",
  "",
  "1. Generalize the mention pipeline",
  "2. Wire the `promptMentions` prop",
  "3. Render the bubble",
  "",
  "- keep the char cap",
  "- keep collapse / expand",
].join("\n");

const MENTIONS_BODY =
  "Ask @thread:thr_child to update @src/promptbox/PromptBoxInternal.tsx, then run /deploy.";
const MENTIONS: readonly PromptTextMention[] = [
  mentionAt(MENTIONS_BODY, "@thread:thr_child", {
    kind: "thread",
    threadId: "thr_child",
    projectId: "proj_demo",
    label: "Prompt markdown",
  }),
  mentionAt(MENTIONS_BODY, "@src/promptbox/PromptBoxInternal.tsx", {
    kind: "path",
    source: "workspace",
    entryKind: "file",
    path: "src/promptbox/PromptBoxInternal.tsx",
    label: "PromptBoxInternal.tsx",
  }),
  mentionAt(MENTIONS_BODY, "/deploy", {
    kind: "command",
    trigger: "/",
    name: "deploy",
    source: "command",
    origin: "user",
    label: "deploy",
    argumentHint: null,
  }),
];

const QUOTE_BODY = [
  "> First we backfill the new column at the server boundary,",
  "> then flip reads once every row is populated.",
  "",
  "Which phase is safe to deploy on a Friday?",
].join("\n");

// Long enough to overflow the collapsed clamp and reveal "Show more".
const LONG_BODY = [
  "# Migration rollout",
  "",
  ...Array.from(
    { length: 20 },
    (_unused, index) =>
      `${index + 1}. Step ${index + 1}: verify the batch, then advance the cursor and re-check invariants.`,
  ),
].join("\n");

export function Overview() {
  const [draftText, setDraftText] = useState("");
  const handleAddToChat = (text: string) => {
    setDraftText((current) => appendStoryQuote(current, text));
  };

  return (
    <StoryCard>
      <StoryRow
        label="formatting"
        hint="headings, bold/italic, inline code, ordered + unordered lists"
      >
        <UserMessage text={FORMATTING_BODY} onAddToChat={handleAddToChat} />
      </StoryRow>
      <StoryRow
        label="mentions"
        hint="thread (linked), file (interactive), and slash-command pills inside markdown"
      >
        <UserMessage
          text={MENTIONS_BODY}
          mentions={MENTIONS}
          onAddToChat={handleAddToChat}
        />
      </StoryRow>
      <StoryRow
        label="blockquote"
        hint="`> ` lines render as a native markdown blockquote + reply paragraph"
      >
        <UserMessage text={QUOTE_BODY} onAddToChat={handleAddToChat} />
      </StoryRow>
      <StoryRow
        label="long (collapsible)"
        hint="clamped to ~15 lines with a Show more / Show less toggle"
      >
        <UserMessage text={LONG_BODY} onAddToChat={handleAddToChat} />
      </StoryRow>
      <StoryRow
        label="add to chat result"
        hint="click Add to chat under any markdown user message"
      >
        <DraftQuotePreview text={draftText} />
      </StoryRow>
    </StoryCard>
  );
}
