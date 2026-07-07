import type { ReactNode } from "react";
import { cn } from "@bb/shared-ui/lib/utils";

export interface ConversationTimelineProps {
  children: ReactNode;
  className?: string;
}

export function ConversationTimeline({
  children,
  className,
}: ConversationTimelineProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 [&_button:not(:disabled)]:cursor-pointer",
        className,
      )}
    >
      {children}
    </div>
  );
}
