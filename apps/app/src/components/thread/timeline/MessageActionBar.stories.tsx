import type { ReactNode } from "react";
import { MessageActionBar } from "@/components/thread/timeline/MessageActionBar";
import { useStoryMessageActions } from "@/components/thread/timeline/story-message-actions";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";

export default {
  title: "thread/timeline/Message Action Bar",
};

const noop = () => undefined;
const STORY_TIMESTAMP = Date.UTC(2026, 8, 30, 16, 5);

function HoverRevealStage({ children }: { children: ReactNode }) {
  return (
    <div className="group/message flex items-center gap-2 [&_button]:opacity-100">
      {children}
    </div>
  );
}

function StoryBar({
  text,
  mobileActionDisplay,
  role,
  onAddToChat,
  onFork,
  forkDisabled,
}: {
  text: string;
  mobileActionDisplay: "inline" | "overflow";
  role: "user" | "assistant";
  onAddToChat?: () => void;
  onFork?: () => void;
  forkDisabled?: boolean;
}) {
  const actions = useStoryMessageActions({
    role,
    text,
    onAddToChat,
    onFork,
    forkDisabled,
  });
  return (
    <MessageActionBar
      timestamp={STORY_TIMESTAMP}
      alignment="end"
      mobileActionDisplay={mobileActionDisplay}
      actions={actions}
    />
  );
}

export function Overview() {
  return (
    <>
      <StoryCard>
        <StoryRow label="main timeline" hint="Copy + menu">
          <HoverRevealStage>
            <StoryBar
              role="assistant"
              text="An agent message you can fork or reply to."
              mobileActionDisplay="inline"
              onFork={noop}
            />
          </HoverRevealStage>
        </StoryRow>
        <StoryRow label="user message" hint="Copy + menu">
          <HoverRevealStage>
            <StoryBar
              role="user"
              text="A user message you can quote into the composer."
              mobileActionDisplay="overflow"
              onAddToChat={noop}
            />
          </HoverRevealStage>
        </StoryRow>
        <StoryRow label="disabled" hint="thread not forkable → greyed">
          <HoverRevealStage>
            <StoryBar
              role="assistant"
              text="Fork/Reply greyed when the thread can't fork."
              mobileActionDisplay="inline"
              onFork={noop}
              forkDisabled
            />
          </HoverRevealStage>
        </StoryRow>
      </StoryCard>
    </>
  );
}
