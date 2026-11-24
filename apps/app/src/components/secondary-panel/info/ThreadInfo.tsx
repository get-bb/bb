import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type UIEvent,
} from "react";
import type {
  ExperimentalThreadInfoProps,
  ExperimentalThreadTabProps,
} from "@get-bb/plugin-sdk";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";
import { DetailCard, DETAIL_GRID_CLASS } from "@/components/ui/detail-card.js";
import { useThreadState } from "@/lib/thread-state";
import { ThreadInfoRows, ThreadInfoSections } from "./ThreadInfoSlots";

const INFO_SCROLLBAR_IDLE_DELAY_MS = 600;

export function ThreadInfoCard({ children }: { children: ReactNode }) {
  const scrollbarIdleTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (scrollbarIdleTimeoutRef.current !== null) {
        window.clearTimeout(scrollbarIdleTimeoutRef.current);
      }
    },
    [],
  );

  const handleScroll = useCallback((event: UIEvent<HTMLDListElement>) => {
    const scrollArea = event.currentTarget;
    if (scrollArea.dataset.scrollbarScrolling !== "true") {
      scrollArea.dataset.scrollbarScrolling = "true";
    }
    if (scrollbarIdleTimeoutRef.current !== null) {
      window.clearTimeout(scrollbarIdleTimeoutRef.current);
    }
    scrollbarIdleTimeoutRef.current = window.setTimeout(() => {
      scrollbarIdleTimeoutRef.current = null;
      scrollArea.removeAttribute("data-scrollbar-scrolling");
    }, INFO_SCROLLBAR_IDLE_DELAY_MS);
  }, []);

  return (
    <DetailCard
      appearance="flat"
      className="transient-scrollbar min-h-0 flex-1 gap-1.5 overflow-x-hidden overflow-y-auto px-4 py-3 max-md:py-1 max-md:[--detail-label-width:7.5rem]"
      onScroll={handleScroll}
    >
      {children}
    </DetailCard>
  );
}

const SKELETON_ROW_VALUE_WIDTHS = ["w-40", "w-28", "w-36", "w-24"];

export function ThreadInfoSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading thread info"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <ThreadInfoCard>
        {SKELETON_ROW_VALUE_WIDTHS.map((valueWidth, index) => (
          <div
            key={index}
            className={cn(DETAIL_GRID_CLASS, "items-center py-0.5")}
          >
            <Skeleton className="h-3 w-14 rounded-sm" />
            <Skeleton className={`h-3 ${valueWidth} max-w-full rounded-sm`} />
          </div>
        ))}
      </ThreadInfoCard>
    </div>
  );
}

const NO_DETAILS_MESSAGE = "No thread details available.";

function ThreadInfoBody(props: ExperimentalThreadInfoProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ThreadInfoCard>
        <div className="flex min-w-0 flex-col [&_[data-info-section]]:mt-3 [&_[data-info-section]]:border-t [&_[data-info-section]]:border-border [&_[data-info-section]]:pt-3">
          <div className="flex min-w-0 flex-col gap-1.5 [&:not(:has(dt))]:hidden [:not(:has([data-info-section]))>&]:border-b [:not(:has([data-info-section]))>&]:border-border [:not(:has([data-info-section]))>&]:pb-3">
            <ThreadInfoRows {...props} />
          </div>
          <ThreadInfoSections {...props} />
          <p className="hidden text-sm text-muted-foreground [:not(:has(dt)):not(:has([data-info-section]))>&]:block">
            {NO_DETAILS_MESSAGE}
          </p>
        </div>
      </ThreadInfoCard>
    </div>
  );
}

export function ThreadInfo({
  threadId,
  environment,
}: ExperimentalThreadTabProps) {
  const state = useThreadState(threadId);
  if (state.status === "loading") return <ThreadInfoSkeleton />;
  if (state.status !== "ready") {
    return (
      <div className="px-4 pt-1 text-sm text-muted-foreground">
        {NO_DETAILS_MESSAGE}
      </div>
    );
  }
  return (
    <ThreadInfoBody
      threadId={threadId}
      projectId={state.thread.projectId}
      environment={environment}
    />
  );
}
