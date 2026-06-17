import type { ReactNode } from "react";
import { MessageActionBar } from "@/components/thread/timeline/MessageActionBar";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";

export default {
  title: "thread/timeline/Message Action Bar",
};

const noop = () => undefined;

// In production the actions hide until the surrounding `group/message` row is
// hovered or focused. The wrapper supplies that group and force-reveals the
// buttons (`[&_button]:opacity-100`) so every action is visible in the story.
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
        <StoryRow label="main timeline" hint="Fork + Reply (side chat)">
          <HoverRevealStage>
            <MessageActionBar
              messageText="An agent message you can fork or reply to."
              alignment="end"
              onFork={noop}
              onSideChat={noop}
            />
          </HoverRevealStage>
        </StoryRow>
        <StoryRow label="disabled" hint="thread not forkable → greyed">
          <HoverRevealStage>
            <MessageActionBar
              messageText="Fork/Reply greyed when the thread can't fork."
              alignment="end"
              onFork={noop}
              onSideChat={noop}
              disabled
            />
          </HoverRevealStage>
        </StoryRow>
        <StoryRow
          label="inside a side chat"
          hint="Send to main thread, no fork/reply"
        >
          <HoverRevealStage>
            <MessageActionBar
              messageText="A side-chat reply you can hand back to the main thread."
              alignment="start"
              onSendToMain={noop}
            />
          </HoverRevealStage>
        </StoryRow>
      </StoryCard>
    </>
  );
}
