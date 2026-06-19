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
        label="collapsed"
        hint="active Claude Code plan mode indicator with cleaned prompt"
      >
        <Stage>
          <div className="flex flex-col gap-2">
            <ThreadPromptModeCard
              activePromptMode={{
                mode: "plan",
                providerId: "claude-code",
                prompt: "inspect the failing command before making changes",
              }}
              isExpanded={false}
              onExitPlanMode={() => {}}
              onToggle={() => {}}
            />
            <FauxComposer />
          </div>
        </Stage>
      </StoryRow>
      <StoryRow label="expanded" hint="unfurled prompt body is capped">
        <Stage>
          <ThreadPromptModeCard
            activePromptMode={{
              mode: "plan",
              providerId: "claude-code",
              prompt:
                "inspect the failing command before making changes. Check the relevant timeline state, compare the provider-specific behavior, and explain the safest implementation path before editing.",
            }}
            isExpanded
            onExitPlanMode={() => {}}
            onToggle={() => {}}
          />
        </Stage>
      </StoryRow>
      <StoryRow label="codex" hint="same banner for Codex plan mode">
        <Stage>
          <ThreadPromptModeCard
            activePromptMode={{
              mode: "plan",
              providerId: "codex",
              prompt: "review the merge conflicts and propose a fix plan",
            }}
            isExpanded={false}
            onToggle={() => {}}
          />
        </Stage>
      </StoryRow>
      <StoryRow label="inactive" hint="renders nothing without active mode">
        <Stage>
          <ThreadPromptModeCard
            activePromptMode={null}
            isExpanded={false}
            onToggle={() => {}}
          />
        </Stage>
      </StoryRow>
    </StoryCard>
  );
}
