import type { ReactNode } from "react";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";
import { ConversationTimeline } from "@/components/ui/conversation.js";

export function ThreadTimelinePanelLoadingSkeleton() {
  return (
    <div className="space-y-2 px-2 pt-2">
      <Skeleton className="h-4 w-3/4 rounded-sm" />
      <Skeleton className="h-4 w-2/3 rounded-sm" />
      <Skeleton className="h-4 w-1/2 rounded-sm" />
    </div>
  );
}

export function ThreadChatLoadingBody({
  leadingContent,
  variant,
}: {
  leadingContent: ReactNode;
  variant: "full" | "compact" | "timeline";
}) {
  return (
    <div
      role="status"
      aria-label="Loading conversation"
      className={cn(
        variant === "timeline"
          ? "px-2 pb-3 pt-3"
          : variant === "full"
            ? "mx-auto w-full max-w-[760px] px-4 pb-3 pt-4"
            : "px-2 pb-3 pt-4",
      )}
    >
      <ConversationTimeline>
        {leadingContent}
        <ThreadTimelinePanelLoadingSkeleton />
      </ConversationTimeline>
    </div>
  );
}
