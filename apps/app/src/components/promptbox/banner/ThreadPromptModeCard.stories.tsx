import { useState } from "react";
import type { ThreadTimelineActivePromptMode } from "@bb/domain";
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

function ToggleablePromptModeCard({
  activePromptMode,
  initiallyExpanded = false,
  onExitPlanMode,
}: {
  activePromptMode: ThreadTimelineActivePromptMode | null;
  initiallyExpanded?: boolean;
  onExitPlanMode?: () => void;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  return (
    <ThreadPromptModeCard
      activePromptMode={activePromptMode}
      isExpanded={expanded}
      onExitPlanMode={onExitPlanMode}
      onToggle={() => setExpanded((value) => !value)}
    />
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="collapsed"
        hint="active Claude Code plan mode indicator; prompt stays hidden"
      >
        <Stage>
          <div className="flex flex-col gap-2">
            <ToggleablePromptModeCard
              activePromptMode={{
                mode: "plan",
                providerId: "claude-code",
                prompt: "inspect the failing command before making changes",
              }}
              onExitPlanMode={() => {}}
            />
            <FauxComposer />
          </div>
        </Stage>
      </StoryRow>
      <StoryRow label="expanded" hint="unfurled body shows full cleaned prompt">
        <Stage>
          <ToggleablePromptModeCard
            activePromptMode={{
              mode: "plan",
              providerId: "claude-code",
              prompt:
                "inspect the failing command before making changes. Check the relevant timeline state, compare the provider-specific behavior, and explain the safest implementation path before editing.",
            }}
            initiallyExpanded
            onExitPlanMode={() => {}}
          />
        </Stage>
      </StoryRow>
      <StoryRow label="codex" hint="same banner for Codex plan mode">
        <Stage>
          <ToggleablePromptModeCard
            activePromptMode={{
              mode: "plan",
              providerId: "codex",
              prompt: "review the merge conflicts and propose a fix plan",
            }}
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
