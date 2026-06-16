import type { ReactNode } from "react";
import { GeneratedConversationMessage } from "@/components/thread/timeline/GeneratedConversationMessage";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";

export default {
  title: "thread/timeline/Generated Conversation Message",
};

// The agent-initiated "seed" row that opens a fork or side chat. The lead-in and
// leading icon are derived from `childOrigin`: a fork reads "Forked from <source>"
// with the Fork glyph; a side chat reads "Replying to"; any other agent message
// keeps "Message from".
function TimelineStage({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-[520px]">{children}</div>;
}

const EMPTY_ATTACHMENTS = { filePaths: [], imageItems: [] };
const ACCEPTED_REQUEST = { kind: "message", status: "accepted" } as const;

export function Overview() {
  return (
    <>
      <StoryCard>
        <StoryRow label="fork" hint='childOrigin "fork" → "Forked from" + Fork icon'>
          <TimelineStage>
            <GeneratedConversationMessage
              attachmentItems={EMPTY_ATTACHMENTS}
              childOrigin="fork"
              mentions={[]}
              sourceKind="agent"
              sourceName="Fork Context Summary"
              sourceThreadId="thr_source"
              sourceIsSideChat={false}
              text="Hi. What would you like to work on?"
              turnRequest={ACCEPTED_REQUEST}
            />
          </TimelineStage>
        </StoryRow>
        <StoryRow
          label="side chat"
          hint='childOrigin "side-chat" → "Replying to"'
        >
          <TimelineStage>
            <GeneratedConversationMessage
              attachmentItems={EMPTY_ATTACHMENTS}
              childOrigin="side-chat"
              mentions={[]}
              sourceKind="agent"
              sourceName="Stabilize Pnpm Dev Environment"
              sourceThreadId="thr_source"
              sourceIsSideChat={false}
              text="Here is more: a small, useful sentence with no extra ceremony."
              turnRequest={ACCEPTED_REQUEST}
            />
          </TimelineStage>
        </StoryRow>
        <StoryRow
          label="agent (other)"
          hint='childOrigin null → "Message from"'
        >
          <TimelineStage>
            <GeneratedConversationMessage
              attachmentItems={EMPTY_ATTACHMENTS}
              childOrigin={null}
              mentions={[]}
              sourceKind="agent"
              sourceName="Manager"
              sourceThreadId="thr_source"
              sourceIsSideChat={false}
              text="Delegated task: investigate the flaky timeline test."
              turnRequest={ACCEPTED_REQUEST}
            />
          </TimelineStage>
        </StoryRow>
        <StoryRow label="system" hint='sourceKind "system" → "System Message"'>
          <TimelineStage>
            <GeneratedConversationMessage
              attachmentItems={EMPTY_ATTACHMENTS}
              childOrigin={null}
              mentions={[]}
              sourceKind="system"
              sourceName=""
              sourceThreadId={null}
              sourceIsSideChat={false}
              text="Provisioned thread."
              turnRequest={ACCEPTED_REQUEST}
            />
          </TimelineStage>
        </StoryRow>
      </StoryCard>
    </>
  );
}
