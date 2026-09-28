import { useState } from "react";
import { DelayedLoading } from "./delayed-loading.js";
import { Skeleton } from "./skeleton.js";
import { Button } from "./button.js";
import { cn } from "../../lib/utils";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/DelayedLoading",
};

function DocumentSkeletonDemo() {
  return (
    <div
      className="mx-auto w-full max-w-sm space-y-6 rounded-md border border-border p-6"
      role="status"
      aria-label="Loading document"
    >
      <span className="sr-only">Loading…</span>
      <div className="space-y-3">
        <Skeleton className="h-6 w-2/5" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      <div className="space-y-2">
        {["w-11/12", "w-4/5", "w-2/3"].map((widthClass) => (
          <div className="flex items-center gap-3" key={widthClass}>
            <Skeleton className="size-4 shrink-0" />
            <Skeleton className={cn("h-4", widthClass)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ToggleReplayDemo() {
  const [key, setKey] = useState(0);
  return (
    <div className="space-y-3">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setKey((current) => current + 1)}
      >
        Replay 200ms delay
      </Button>
      <DelayedLoading key={key}>
        <DocumentSkeletonDemo />
      </DelayedLoading>
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Document skeleton, gated"
        hint="plugins/docs/app.tsx — DocumentSkeleton wrapped in DelayedLoading so a fast load never flashes a skeleton"
      >
        <ToggleReplayDemo />
      </StoryRow>
    </StoryCard>
  );
}
