import { NavLink } from "react-router-dom";
import type { ThreadHandoffStatus } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { getThreadRoutePath } from "@/lib/route-paths";

export interface ThreadTakeoverBannerProps {
  onRestoreSource: () => void;
  onRetry?: () => void;
  onReturnToSource: () => void;
  projectId: string;
  restorePending?: boolean;
  retryPending?: boolean;
  sourceTitle: string;
  status: ThreadHandoffStatus;
}

export function ThreadTakeoverBanner({
  onRestoreSource,
  onRetry,
  onReturnToSource,
  projectId,
  restorePending = false,
  retryPending = false,
  sourceTitle,
  status,
}: ThreadTakeoverBannerProps) {
  const sourcePath = getThreadRoutePath({
    projectId,
    threadId: status.sourceThreadId,
  });

  if (status.state === "failed") {
    return (
      <PromptStackCard ariaLabel="Takeover failed" className="overflow-hidden">
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs"
        >
          <Icon
            name="AlertTriangle"
            className="size-3.5 shrink-0 text-warning-text"
            aria-hidden="true"
          />
          <span className="font-medium text-foreground">Takeover failed</span>
          <span className="text-muted-foreground">
            {status.failure?.message ?? "The replacement did not start."} The
            source thread is still live.
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={onReturnToSource}>
              Return to source
            </Button>
            {onRetry ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={retryPending}
                onClick={onRetry}
              >
                Retry
              </Button>
            ) : null}
          </div>
        </div>
      </PromptStackCard>
    );
  }

  if (status.state === "provisioning") {
    return (
      <PromptStackCard
        ariaLabel="Taking over from source thread"
        className="overflow-hidden"
      >
        <div
          role="status"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs"
        >
          <Icon name="Spinner" className="size-3.5 animate-spin" aria-hidden="true" />
          <span className="font-medium text-foreground">
            Taking over from {sourceTitle}
          </span>
        </div>
      </PromptStackCard>
    );
  }

  return (
    <PromptStackCard
      ariaLabel="Taken over from source thread"
      className="overflow-hidden"
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
        <span className="font-medium text-foreground">
          Taken over from{" "}
          <NavLink to={sourcePath} className="underline underline-offset-2">
            {sourceTitle}
          </NavLink>
        </span>
        {status.sourceArchived ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={restorePending}
            onClick={onRestoreSource}
          >
            Restore source thread
          </Button>
        ) : null}
      </div>
    </PromptStackCard>
  );
}
