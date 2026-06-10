import type { TimelineConversationAttachments } from "@bb/server-contract";
import type { PromptMentionResource, PromptTextMention } from "@bb/domain";
import type { TimelineTitleLink } from "@bb/thread-view";
import type { ReactNode } from "react";
import { ConversationMessageContent } from "@/components/thread/timeline/ConversationMessageContent";
import { StoryCard, StoryRow } from "../../../../../.ladle/story-card";

export default {
  title: "thread/timeline/rows/User Message",
};

// Match production: ThreadTimelinePane's PageShell content area caps at
// 760px. Without it the message bubble stretches the full row width and
// doesn't reflect what users see.
interface TimelineStageProps {
  children: ReactNode;
}

function TimelineStage({ children }: TimelineStageProps) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

// Resolves placecats URLs (which are already absolute) and falls through for
// project-relative paths the same way the production resolver would.
const resolveImageSrc = (path: string) => path;

function resolveThreadLink(link: TimelineTitleLink): string | null {
  switch (link.kind) {
    case "thread":
      return `/projects/proj_demo/threads/${link.threadId}`;
    default:
      return null;
  }
}

const acceptedMessage = {
  kind: "message" as const,
  status: "accepted" as const,
};
const pendingSteer = { kind: "steer" as const, status: "pending" as const };
const acceptedSteer = { kind: "steer" as const, status: "accepted" as const };

interface StoryMentionArgs {
  resource: PromptMentionResource;
  text: string;
  token: string;
}

function storyMention({
  resource,
  text,
  token,
}: StoryMentionArgs): PromptTextMention {
  const start = text.indexOf(token);
  if (start < 0) {
    throw new Error(`Missing story mention token: ${token}`);
  }
  return {
    start,
    end: start + token.length,
    resource,
  };
}

// CollapsibleMessageText kicks in at > 15 pre-wrapped lines, so this fixture
// crosses that threshold to exercise the Show more / Show less affordance.
const longMarkdownText = `Audit \`apps/app/src/components/promptbox/FollowUpPromptBox.tsx\` for the same prop trims we did on the banner.

Specifically I want you to look at:

- Optional fields that hide defaults (per AGENTS.md: "Optional contract fields are allowed only when leaving the field out has its own real semantic meaning")
- Wrapper-shape mismatches where the outer prop renames fields just to rename them back at the call site
- Boolean soup that could collapse into one discriminated union (we already did this for ComposerSubmitMode)
- Slot candidates where the wrapper passes structured data but does no logic on it
- Layout-coupling smells where a top-level prop only exists because it sits next to another visual element
- Accepted-but-overridden fields (the picker's readOnly was a recent example)
- Fields that look like they should live on a different prop block

Examples of trims we landed recently for reference:

1. \`banner\` collapsed from 13 fields to a \`ReactNode | null\` slot
2. \`ComposerMentionsProps\` shim removed in favor of canonical \`MentionsConfig\`
3. \`ComposerAttachmentsProps\` same — drop the rename, use \`AttachmentsConfig\`
4. \`provider.readOnly\` removed; locked-ness derived from \`!provider.onChange\`

Reply with a punch list, not code. Each item should call out the current shape, the recommended shape, and a one-line reason for why the current shape is wrong.

Cap at ~600 words. Lead with the highest-value trims so I can prioritize.`;

const longSystemMessageText = `[bb system]

Scheduled follow-up: refresh the active project context, collect the latest thread status, and prepare a concise handoff for the next assistant turn. This fixture is intentionally long enough to exercise the expanded generated-message body.

Additional detail confirms that expanding the row preserves the rest of the message body.`;

const singleImageAttachments: TimelineConversationAttachments = {
  webImages: 0,
  localImages: 1,
  localFiles: 0,
  imageUrls: [],
  localImagePaths: ["https://placecats.com/300/200"],
  localFilePaths: [],
};

const mixedAttachments: TimelineConversationAttachments = {
  webImages: 1,
  localImages: 2,
  localFiles: 1,
  imageUrls: ["https://placecats.com/360/220"],
  localImagePaths: [
    "https://placecats.com/300/180",
    "https://placecats.com/320/200",
  ],
  localFilePaths: ["docs/refactor-notes.md"],
};

const mentionedMessageText =
  "Ask @thread:thr_parent and @apps/app/src/components/promptbox/PromptBoxInternal.tsx to review the prompt mention flow.";
const mentionedMessageMentions: PromptTextMention[] = [
  storyMention({
    text: mentionedMessageText,
    token: "@thread:thr_parent",
    resource: {
      kind: "thread",
      threadId: "thr_parent",
      projectId: "proj_bb",
      label: "Prompt UX thread",
    },
  }),
  storyMention({
    text: mentionedMessageText,
    token: "@apps/app/src/components/promptbox/PromptBoxInternal.tsx",
    resource: {
      kind: "path",
      source: "workspace",
      entryKind: "file",
      path: "apps/app/src/components/promptbox/PromptBoxInternal.tsx",
      label: "PromptBoxInternal.tsx",
    },
  }),
];

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="short">
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            senderThreadId={null}
            senderThreadTitle={null}
            text="Walk me through how ThreadDetailView wires the prompt context banner."
            attachments={null}
            mentions={[]}
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="mentions"
        hint="thread mentions link; file mentions are display-only pills with full-path hover"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            senderThreadId={null}
            senderThreadTitle={null}
            text={mentionedMessageText}
            attachments={null}
            mentions={mentionedMessageMentions}
            projectId="proj_bb"
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="long"
        hint="multi-line markdown with code fence + bullets"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            senderThreadId={null}
            senderThreadTitle={null}
            text={longMarkdownText}
            attachments={null}
            mentions={[]}
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="pending"
        hint="turnRequest.kind = steer, status = pending — interruption mid-turn"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            senderThreadId={null}
            senderThreadTitle={null}
            text="Hold on — also include the queue API in that audit, please."
            attachments={null}
            mentions={[]}
            turnRequest={pendingSteer}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="accepted steer"
        hint="steer that the runtime has acknowledged and folded into the turn"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            senderThreadId={null}
            senderThreadTitle={null}
            text="Hold on — also include the queue API in that audit, please."
            attachments={null}
            mentions={[]}
            turnRequest={acceptedSteer}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow label="with image" hint="single localImage attachment">
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            senderThreadId={null}
            senderThreadTitle={null}
            text="Repro of the layout regression in the prompt context banner."
            attachments={singleImageAttachments}
            mentions={[]}
            turnRequest={acceptedMessage}
            resolveUserAttachmentImageSrc={resolveImageSrc}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="with images and mixed attachments"
        hint="2 local images + 1 web image + 1 local file"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            senderThreadId={null}
            senderThreadTitle={null}
            text="Three screenshots from the design review and the spec doc."
            attachments={mixedAttachments}
            mentions={[]}
            turnRequest={acceptedMessage}
            resolveUserAttachmentImageSrc={resolveImageSrc}
            onOpenLocalFileLink={() => false}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="agent-initiated"
        hint="collapsed activity row: Message from Frontend thread"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="agent"
            resolveSegmentLinkHref={resolveThreadLink}
            senderThreadId="thr_sender123"
            senderThreadTitle="Frontend thread"
            text={
              "[bb message from thread:thr_sender123]\n\nHey — I finished the audit you asked for. Punch list is in `notes/audit-2026-05.md`; the highest-value trim is collapsing the picker-shape options into a discriminated union."
            }
            attachments={null}
            mentions={[]}
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="generated steers"
        hint="steer status appears in the expanded body, not the row title"
      >
        <div className="flex w-full max-w-[760px] flex-col gap-3">
          <ConversationMessageContent
            role="user"
            initiator="agent"
            resolveSegmentLinkHref={resolveThreadLink}
            senderThreadId="thr_sender123"
            senderThreadTitle="Frontend thread"
            text={
              "[bb message from thread:thr_sender123]\n\nOne more note from the frontend manager while the current turn is already running."
            }
            attachments={null}
            mentions={[]}
            turnRequest={acceptedSteer}
          />
          <ConversationMessageContent
            role="user"
            initiator="system"
            senderThreadId={null}
            senderThreadTitle={null}
            text={"[bb system]\n\nScheduled follow-up requested mid-turn."}
            attachments={null}
            mentions={[]}
            turnRequest={pendingSteer}
          />
        </div>
      </StoryRow>
      <StoryRow
        label="system-initiated (scheduled turn)"
        hint="collapsed activity row: System Message"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="system"
            senderThreadId={null}
            senderThreadTitle={null}
            text={"[bb system]\n\nScheduled turn: daily-recap."}
            attachments={null}
            mentions={[]}
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="system-initiated (welcome)"
        hint="system message body is shown after expanding the row"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="system"
            senderThreadId={null}
            senderThreadTitle={null}
            text={
              "[bb system]\n\nWelcome!\nStart with a short meet-and-greet."
            }
            attachments={null}
            mentions={[]}
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="system-initiated (long)"
        hint="expanded body shows the full generated message"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="system"
            senderThreadId={null}
            senderThreadTitle={null}
            text={longSystemMessageText}
            attachments={null}
            mentions={[]}
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
    </StoryCard>
  );
}
