import type { ReactNode } from "react";
import { MessageActionBar } from "@/components/thread/timeline/MessageActionBar";
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

export function Overview() {
  return (
    <>
      <StoryCard>
        <StoryRow label="main timeline" hint="Copy + menu">
          <HoverRevealStage>
            <MessageActionBar
              timestamp={STORY_TIMESTAMP}
              messageText="An agent message you can fork or reply to."
              alignment="end"
              mobileActionDisplay="inline"
              onFork={noop}
            />
          </HoverRevealStage>
        </StoryRow>
        <StoryRow label="user message" hint="Copy + menu">
          <HoverRevealStage>
            <MessageActionBar
              timestamp={STORY_TIMESTAMP}
              messageText="A user message you can quote into the composer."
              alignment="end"
              mobileActionDisplay="overflow"
              onAddToChat={noop}
            />
          </HoverRevealStage>
        </StoryRow>
        <StoryRow label="disabled" hint="thread not forkable → greyed">
          <HoverRevealStage>
            <MessageActionBar
              timestamp={STORY_TIMESTAMP}
              messageText="Fork/Reply greyed when the thread can't fork."
              alignment="end"
              mobileActionDisplay="inline"
              onFork={noop}
              disabled
            />
          </HoverRevealStage>
        </StoryRow>
      </StoryCard>
    </>
  );
}
