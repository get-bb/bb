import { EmptyState } from "./empty-state.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/EmptyState",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Empty thread list"
        hint="plugins/thread-list/ThreadListEmptyState.tsx — sidebar's no-threads message, icon + muted text"
      >
        <EmptyState
          message="No threads"
          icon="MessageSquare"
          iconClassName="size-3.5 text-subtle-foreground/50"
          messageClassName="text-xs leading-4 text-subtle-foreground/60"
        />
      </StoryRow>
    </StoryCard>
  );
}
