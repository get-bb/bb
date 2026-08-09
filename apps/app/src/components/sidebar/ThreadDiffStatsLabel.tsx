import { formatCompactDiffCount, formatDiffCount } from "@bb/thread-view";
import { cn } from "@bb/shared-ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { useEnvironmentWorkStatus } from "@/hooks/queries/environment-queries";
import { selectWorkspaceChangedFilesSection } from "@/components/workspace/workspace-change-summary";

interface ThreadDiffStatsLabelProps {
  className?: string;
  environmentId: string | null;
}

interface ThreadEnvironmentDiffStatsLabelProps {
  className?: string;
  environmentId: string;
}

export function ThreadDiffStatsLabel({
  className,
  environmentId,
}: ThreadDiffStatsLabelProps) {
  if (environmentId === null) return null;

  return (
    <ThreadEnvironmentDiffStatsLabel
      className={className}
      environmentId={environmentId}
    />
  );
}

function ThreadEnvironmentDiffStatsLabel({
  className,
  environmentId,
}: ThreadEnvironmentDiffStatsLabelProps) {
  const { data } = useEnvironmentWorkStatus(environmentId);
  const workspaceStatus =
    data?.outcome === "available" ? data.workspace : undefined;
  const changedFilesSection =
    selectWorkspaceChangedFilesSection(workspaceStatus);
  const added = changedFilesSection?.stats.insertions ?? 0;
  const removed = changedFilesSection?.stats.deletions ?? 0;

  if (changedFilesSection === null || (added === 0 && removed === 0)) {
    return null;
  }

  const addedLabel = formatDiffCount(added);
  const removedLabel = formatDiffCount(removed);
  const summaryLabel = `+${addedLabel} -${removedLabel} lines changed`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "shrink-0 whitespace-nowrap font-mono text-xs",
            className,
          )}
          aria-label={`+${addedLabel} lines added, -${removedLabel} lines removed`}
          data-sidebar-thread-diff-stats=""
        >
          <span className="text-diff-added">
            +{formatCompactDiffCount(added)}
          </span>{" "}
          <span className="text-diff-removed">
            -{formatCompactDiffCount(removed)}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{summaryLabel}</TooltipContent>
    </Tooltip>
  );
}
