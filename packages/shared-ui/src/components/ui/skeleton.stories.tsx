import { useId, useMemo } from "react";
import { Skeleton } from "./skeleton.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Skeleton",
};

function SidebarMenuSkeletonDemo() {
  const skeletonId = useId();
  const width = useMemo(() => {
    let hash = 0;
    for (let index = 0; index < skeletonId.length; index += 1) {
      hash = (hash + skeletonId.charCodeAt(index) * (index + 1)) % 40;
    }
    return `${hash + 50}%`;
  }, [skeletonId]);

  return (
    <div className="w-64 space-y-1 rounded-md border border-border p-2">
      {[width, "70%", "55%"].map((rowWidth, index) => (
        <div
          key={index}
          className="flex h-8 items-center gap-2 rounded-md px-2"
        >
          <Skeleton className="h-4 flex-1" style={{ maxWidth: rowWidth }} />
        </div>
      ))}
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Sidebar menu row"
        hint="plugins/thread-list/sidebar.tsx — SidebarMenuSkeleton sizes each row to a pseudo-random width via a hashed id"
      >
        <SidebarMenuSkeletonDemo />
      </StoryRow>
    </StoryCard>
  );
}
