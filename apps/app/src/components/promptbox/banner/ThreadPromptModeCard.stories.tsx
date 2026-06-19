import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { ThreadPromptModeCard } from "./ThreadPromptModeCard";

export default {
  title: "promptbox/banner/Prompt Mode Card",
};

function Stage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

function FauxComposer() {
  return (
    <div className="rounded-lg border border-border bg-popover p-3">
      <div className="pb-3 text-sm text-subtle-foreground">
        Ask for a follow-up...
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
          claude
        </span>
      </div>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="creating plan"
        hint="active Claude Code plan mode indicator above the composer"
      >
        <Stage>
          <div className="flex flex-col gap-2">
            <ThreadPromptModeCard
              activePromptMode={{ mode: "plan", providerId: "claude-code" }}
            />
            <FauxComposer />
          </div>
        </Stage>
      </StoryRow>
      <StoryRow label="inactive" hint="renders nothing without active mode">
        <Stage>
          <ThreadPromptModeCard activePromptMode={null} />
        </Stage>
      </StoryRow>
    </StoryCard>
  );
}
