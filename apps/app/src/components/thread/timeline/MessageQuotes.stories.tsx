import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { MarkdownPreview } from "@/components/ui/markdown-preview.js";
import { Icon } from "@bb/shared-ui/icon";
import {
  messageBodyHasQuote,
  renderMessageBodyWithQuotes,
} from "./ConversationMessageMentions";

export default {
  title: "thread/timeline/MessageQuotes",
};

// A short quoted-selection + reply, the shape "Add to chat" produces.
const QUOTE_AND_REPLY =
  "> First we backfill the new column with a default value at the server\n> boundary, then flip reads once every row is populated.\nWhich phase is safe to deploy on a Friday?";

const TWO_QUOTES =
  "> Backfill the new column first.\nmakes sense\n\n> Then drop the legacy column.\nin the same deploy?";

// Mirrors the agent prose bubble in ConversationMessageContent.
function AgentBubble({ content }: { content: string }) {
  return (
    <div className="group/message w-full px-2 text-sm font-normal leading-relaxed">
      <MarkdownPreview content={content} />
    </div>
  );
}

// Mirrors the right-aligned user message bubble in ConversationMessageContent.
function UserBubble({ text }: { text: string }) {
  return (
    <div className="w-full">
      <div className="ml-auto w-fit max-w-[80%]">
        <div className="rounded-md bg-surface-recessed p-2 text-sm leading-relaxed text-foreground">
          {messageBodyHasQuote(text) ? (
            <div className="break-words">
              {renderMessageBodyWithQuotes({ mentions: [], text })}
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">{text}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// Mirrors the side-chat "Replying to" anchor card in SideChatTabContent.
function ReplyingToCard({ text }: { text: string }) {
  return (
    <div className="mx-1 flex flex-col items-start gap-1">
      <span className="text-xs leading-none text-muted-foreground">
        <Icon
          name="CornerDownRight"
          className="mr-1 inline-block size-3 align-middle"
        />
        Replying to
      </span>
      <div className="max-w-full rounded-md bg-surface-recessed p-1.5 text-xs leading-5 text-foreground">
        {messageBodyHasQuote(text) ? (
          <div className="max-h-20 overflow-hidden break-words">
            {renderMessageBodyWithQuotes({ mentions: [], text })}
          </div>
        ) : (
          <p className="line-clamp-2 whitespace-pre-wrap break-words">{text}</p>
        )}
      </div>
    </div>
  );
}

// Mirrors a queued-message row in QueuedMessagesList (quote branch).
function QueuedRow({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-1 rounded-md border border-border bg-surface-recessed px-2 py-1">
      <Icon
        name="ArrowTurnForward"
        className="mt-0.5 size-3.5 shrink-0 opacity-70"
      />
      <div className="min-w-0 flex-1 text-xs leading-4 text-foreground">
        <div className="max-h-16 overflow-hidden break-words" title={text}>
          {renderMessageBodyWithQuotes({ mentions: [], text })}
        </div>
      </div>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="agent message"
        hint="MarkdownPreview renders > as a styled blockquote (left accent, muted)"
      >
        <div className="w-full max-w-[680px]">
          <AgentBubble content={QUOTE_AND_REPLY} />
        </div>
      </StoryRow>
      <StoryRow
        label="user message"
        hint="quote → reply rendered as blockquote + paragraph (renderMessageBodyWithQuotes)"
      >
        <div className="w-full max-w-[680px]">
          <UserBubble text={QUOTE_AND_REPLY} />
        </div>
      </StoryRow>
      <StoryRow
        label="user message — two quotes"
        hint="stacked quote→reply sections"
      >
        <div className="w-full max-w-[680px]">
          <UserBubble text={TWO_QUOTES} />
        </div>
      </StoryRow>
      <StoryRow
        label="side-chat anchor"
        hint="'Replying to' card renders the selection's > lines as quotes (height-capped)"
      >
        <div className="w-full max-w-[420px]">
          <ReplyingToCard text={QUOTE_AND_REPLY} />
        </div>
      </StoryRow>
      <StoryRow
        label="queued message"
        hint="quoted queued message renders styled, capped to a compact height"
      >
        <div className="w-full max-w-[460px]">
          <QueuedRow text={QUOTE_AND_REPLY} />
        </div>
      </StoryRow>
    </StoryCard>
  );
}
