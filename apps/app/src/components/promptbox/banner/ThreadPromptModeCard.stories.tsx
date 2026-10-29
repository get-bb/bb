import type { ThreadTimelineActivePromptMode } from "@bb/domain";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { ResponsiveStage } from "./banner-story-stages";
import { ThreadPromptModeCard } from "./ThreadPromptModeCard";

export default {
  title: "promptbox/banner/Prompt Mode Card",
};

function ToggleablePromptModeCard({
  activePromptMode,
}: {
  activePromptMode: ThreadTimelineActivePromptMode | null;
}) {
  return (
    <ThreadPromptModeCard
      activePromptMode={activePromptMode}
      onExitPlanMode={async () => {}}
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
        <ResponsiveStage>
          <ToggleablePromptModeCard
            activePromptMode={{
              mode: "plan",
              providerId: "claude-code",
              prompt: "inspect the failing command before making changes",
            }}
          />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="long prompt"
        hint="click the header to unfurl the full prompt"
      >
        <ResponsiveStage>
          <ToggleablePromptModeCard
            activePromptMode={{
              mode: "plan",
              providerId: "claude-code",
              prompt:
                "inspect the failing command before making changes. Check the relevant timeline state, compare the provider-specific behavior, and explain the safest implementation path before editing.",
            }}
          />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow label="codex" hint="same banner for Codex plan mode">
        <ResponsiveStage>
          <ToggleablePromptModeCard
            activePromptMode={{
              mode: "plan",
              providerId: "codex",
              prompt: "review the merge conflicts and propose a fix plan",
            }}
          />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow label="inactive" hint="renders nothing without active mode">
        <ResponsiveStage>
          <ToggleablePromptModeCard activePromptMode={null} />
        </ResponsiveStage>
      </StoryRow>
    </StoryCard>
  );
}
