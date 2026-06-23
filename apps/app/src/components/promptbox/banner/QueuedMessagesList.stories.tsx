import { useCallback, useState, type ReactNode } from "react";
import type { ThreadQueuedMessage } from "@bb/domain";
import {
  applyQueuedMessageReorder,
  type QueuedMessageReorderRequest,
} from "@/lib/queued-message-reorder";
import { QueuedMessagesList } from "@/components/promptbox/banner/QueuedMessagesList";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";

export default {
  title: "promptbox/banner/Queued Messages",
};

const noop = () => {};

type StageSize = "desktop" | "mobile";

interface PromptStageProps {
  children: ReactNode;
  size: StageSize;
}

function PromptStage({ children, size }: PromptStageProps) {
  return (
    <div
      data-promptbox-shell=""
      className={
        size === "desktop" ? "min-w-0 flex-1" : "w-[20rem] shrink-0"
      }
    >
      {children}
    </div>
  );
}

function ResponsivePromptStage({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full min-w-0 items-start gap-3 overflow-x-auto">
      <PromptStage size="desktop">{children}</PromptStage>
      <PromptStage size="mobile">{children}</PromptStage>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Realistic bb-flavored fixtures
// ---------------------------------------------------------------------------

function makeQueuedMessage({
  id,
  text,
  attachments = 0,
}: {
  id: string;
  text: string;
  attachments?: number;
}): ThreadQueuedMessage {
  const attachmentChunks = Array.from({ length: attachments }, (_, index) => ({
    type: "localImage" as const,
    path: `https://placecats.com/${300 + index * 20}/${200 + index * 10}`,
    name: `screenshot-${index + 1}.png`,
    mimeType: "image/png",
    sizeBytes: 100_000 + index * 10_000,
  }));
  return {
    id,
    content: [{ type: "text", text, mentions: [] }, ...attachmentChunks],
    model: "gpt-5.5",
    reasoningLevel: "medium",
    permissionMode: "workspace-write",
    serviceTier: "default",
    createdAt: 0,
    updatedAt: 0,
  };
}

const oneMessage: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_1",
    text: "Also check the timeline error overlay before sending.",
  }),
];

const multipleMessages: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_a",
    text: "Also check the timeline error overlay before sending.",
  }),
  makeQueuedMessage({
    id: "q_b",
    text: "Confirm the env summary renders without the branch button on unmanaged environments.",
  }),
  makeQueuedMessage({
    id: "q_c",
    text: "And run the tests for @bb/thread-view.",
  }),
];

const manyMessages: readonly ThreadQueuedMessage[] = Array.from(
  { length: 9 },
  (_, index) =>
    makeQueuedMessage({
      id: `q_many_${index + 1}`,
      text: `Queued follow-up ${index + 1}: check the compact one-line row, right-edge text fade, and vertical scroll fade in the queue drawer.`,
    }),
);

const withAttachments: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_att_1",
    text: "Repro of the layout regression.",
    attachments: 1,
  }),
  makeQueuedMessage({
    id: "q_att_3",
    text: "Three screenshots from the design review.",
    attachments: 3,
  }),
];

const longMessage: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_long",
    text: "Walk through the entire follow-up composer file by file: PromptBoxInternal, FollowUpPromptBox, NewThreadPromptBox, ContextBanner, QueuedMessagesList, PromptStackCard. For each, audit prop names, identify dead fields, and propose a trim. Skip files we already cleaned up earlier this session.",
  }),
];

// "Add to chat" appends `> `-prefixed blockquote lines into the draft, so a
// queued message can carry quote→reply blocks. The queued row now collapses
// these into one preview line so quoted messages scan like every other row.
const quoteSingle: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_quote_single",
    text: "> The migration runs in three phases.\nWhich phase is safe to deploy on a Friday?",
  }),
];

const quoteMultiline: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_quote_multiline",
    text: "> First we backfill the new column with a default value.\n> Then flip reads once every row is populated.\nMakes sense — what about in-flight writes?",
  }),
];

const quoteTwoBlocks: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_quote_two",
    text: "> Backfill the new column first.\nmakes sense\n\n> Then drop the legacy column.\nin the same deploy?",
  }),
];

const quoteOnly: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_quote_only",
    text: "> Just the quoted selection, no reply typed yet.",
  }),
];

const quoteTruncated: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_quote_truncated",
    text: "> phase one — add the column\n> phase two — start dual-writing\n> phase three — backfill old rows\n> phase four — flip reads\n> phase five — stop writing the old column\n> phase six — drop the old column\nwhich of these is reversible?",
  }),
];

const quoteWithAttachment: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_quote_att",
    text: "> The error fires on the second render.\nrepro attached",
    attachments: 1,
  }),
];

// Quoted and plain messages interleaved in one list — both collapse to one row
// so the queue remains dense even when it contains quote→reply blocks.
const mixedMessages: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "mix_plain_1",
    text: "Also check the timeline error overlay before sending.",
  }),
  makeQueuedMessage({
    id: "mix_quote_1",
    text: "> First we backfill the new column.\n> Then flip reads once every row is populated.\nWhich phase is safe to deploy on a Friday?",
  }),
  makeQueuedMessage({
    id: "mix_plain_2",
    text: "And run the tests for @bb/thread-view.",
  }),
  makeQueuedMessage({
    id: "mix_quote_2",
    text: "> Only after that do we drop the legacy column.\nin the same deploy?",
  }),
];

// Trims the prop boilerplate for the static (non-reorderable) story rows.
function StaticQueuedMessagesList({
  queuedMessages,
}: {
  queuedMessages: readonly ThreadQueuedMessage[];
}) {
  return (
    <QueuedMessagesList
      queuedMessages={queuedMessages}
      sendDisabled={false}
      actionDisabled={false}
      processingMessageId={null}
      processingAction={null}
      onSendImmediately={noop}
      onReorder={noop}
      onEdit={noop}
      onDelete={noop}
    />
  );
}

export function Blockquotes() {
  return (
    <StoryCard>
      <StoryRow
        label="mixed: quoted + plain"
        hint="quoted and plain rows both render as one truncated line"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={mixedMessages} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="plain messages (no quotes)"
        hint="single-line preview, leading icon centered — for comparison"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={multipleMessages} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="quote + reply"
        hint="a single `> ` block above the typed reply"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={quoteSingle} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="multi-line quote"
        hint="every quoted line is prefixed and styled as one blockquote"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={quoteMultiline} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="two quote→reply blocks"
        hint="stacked quote/reply sections in one queued message"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={quoteTwoBlocks} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow label="quote only" hint="quoted selection with no reply yet">
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={quoteOnly} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="long quote (truncated)"
        hint="single-line preview fades at the right edge"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={quoteTruncated} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="quote + attachment"
        hint="attachment count still shows under the quoted block"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={quoteWithAttachment} />
        </ResponsivePromptStage>
      </StoryRow>
    </StoryCard>
  );
}

function ReorderableQueuedMessagesList() {
  const [queuedMessages, setQueuedMessages] =
    useState<readonly ThreadQueuedMessage[]>(multipleMessages);
  const handleReorder = useCallback((request: QueuedMessageReorderRequest) => {
    setQueuedMessages((currentQueuedMessages) =>
      applyQueuedMessageReorder({
        queuedMessages: currentQueuedMessages,
        request,
      }),
    );
  }, []);

  return (
    <QueuedMessagesList
      queuedMessages={queuedMessages}
      sendDisabled={false}
      actionDisabled={false}
      processingMessageId={null}
      processingAction={null}
      onSendImmediately={noop}
      onReorder={handleReorder}
      onEdit={noop}
      onDelete={noop}
    />
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="single message" hint="one queued message">
        <ResponsivePromptStage>
          <QueuedMessagesList
            queuedMessages={oneMessage}
            sendDisabled={false}
            actionDisabled={false}
            processingMessageId={null}
            processingAction={null}
            onSendImmediately={noop}
            onReorder={noop}
            onEdit={noop}
            onDelete={noop}
          />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow label="multiple messages" hint="drag the row icon to reorder">
        <ResponsivePromptStage>
          <ReorderableQueuedMessagesList />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="overflowing queue"
        hint="height-capped list shows top/bottom fades while scrolling"
      >
        <ResponsivePromptStage>
          <QueuedMessagesList
            queuedMessages={manyMessages}
            sendDisabled={false}
            actionDisabled={false}
            processingMessageId={null}
            processingAction={null}
            onSendImmediately={noop}
            onReorder={noop}
            onEdit={noop}
            onDelete={noop}
          />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="with attachments"
        hint="attachment counts shown alongside text"
      >
        <ResponsivePromptStage>
          <QueuedMessagesList
            queuedMessages={withAttachments}
            sendDisabled={false}
            actionDisabled={false}
            processingMessageId={null}
            processingAction={null}
            onSendImmediately={noop}
            onReorder={noop}
            onEdit={noop}
            onDelete={noop}
          />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="long message"
        hint="single line fades at the right edge; title attribute carries full text"
      >
        <ResponsivePromptStage>
          <QueuedMessagesList
            queuedMessages={longMessage}
            sendDisabled={false}
            actionDisabled={false}
            processingMessageId={null}
            processingAction={null}
            onSendImmediately={noop}
            onReorder={noop}
            onEdit={noop}
            onDelete={noop}
          />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="processing one"
        hint="middle row is being sent immediately; its actions disable"
      >
        <ResponsivePromptStage>
          <QueuedMessagesList
            queuedMessages={multipleMessages}
            sendDisabled={false}
            actionDisabled={false}
            processingMessageId="q_b"
            processingAction="send"
            onSendImmediately={noop}
            onReorder={noop}
            onEdit={noop}
            onDelete={noop}
          />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="send disabled"
        hint='runtime busy — cannot "Send now" but edit/delete still work'
      >
        <ResponsivePromptStage>
          <QueuedMessagesList
            queuedMessages={multipleMessages}
            sendDisabled
            actionDisabled={false}
            processingMessageId={null}
            processingAction={null}
            onSendImmediately={noop}
            onReorder={noop}
            onEdit={noop}
            onDelete={noop}
          />
        </ResponsivePromptStage>
      </StoryRow>
    </StoryCard>
  );
}
