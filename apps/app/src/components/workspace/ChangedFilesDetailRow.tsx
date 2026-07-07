import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { DetailRow } from "@/components/ui/detail-card.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { WorkspaceChangesList } from "@/components/thread/WorkspaceChangesList";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  renderChangeSummary,
  toChangeTally,
  type WorkspaceChangedFileSelection,
  type WorkspaceChangedFilesSection,
} from "@/components/workspace/workspace-change-summary";

export interface ChangedFilesDetailRowProps {
  /**
   * Buckets to render in display order. Pass [] to hide the row entirely.
   * When length > 1, the row label becomes a minimal dropdown matching the
   * BranchPicker treatment used by the Merge base row, and the active bucket
   * drives both the aggregate stats and the file list.
   */
  sections: WorkspaceChangedFilesSection[];
  onFileClick?: (selection: WorkspaceChangedFileSelection) => void;
  /** Class applied to the inner `WorkspaceChangesList` (e.g. `h-full`, `max-h-40`). */
  listClassName?: string;
  rowClassName?: string;
  rowValueClassName?: string;
  /** Class applied to the row's label `<dt>` (e.g. a section-header style). */
  labelClassName?: string;
  /**
   * When set, the file list caps at `limit` behind a "Show N more" / "Show
   * less" toggle (like the Commits list) instead of a scrollable box.
   */
  limit?: number;
}

export function ChangedFilesDetailRow({
  sections,
  onFileClick,
  listClassName,
  rowClassName,
  rowValueClassName,
  labelClassName,
  limit,
}: ChangedFilesDetailRowProps) {
  const [selectedKind, setSelectedKind] = useState<
    WorkspaceChangedFilesSection["kind"] | null
  >(null);

  if (sections.length === 0) return null;

  const activeSection =
    sections.find((candidate) => candidate.kind === selectedKind) ??
    sections[0];
  const tally = toChangeTally(activeSection.stats);
  const hasMultipleBuckets = sections.length > 1;

  const aggregate = (
    <span className="truncate text-muted-foreground">
      {renderChangeSummary(tally)}
    </span>
  );

  const label = hasMultipleBuckets ? (
    <span className="flex items-baseline gap-x-3">
      <span className="flex min-w-[var(--detail-label-width,96px)] items-baseline">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-5 w-auto min-w-0 justify-between gap-1 rounded-sm px-0 text-xs font-normal shadow-none hover:bg-transparent data-[state=open]:bg-transparent data-[state=open]:hover:bg-transparent"
              aria-label="Switch changed files bucket"
            >
              <span className="truncate">{activeSection.label}</span>
              <Icon
                name="ChevronDown"
                className="size-3 shrink-0 text-muted-foreground"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {sections.map((option) => (
              <DropdownMenuItem
                key={option.kind}
                onSelect={() => setSelectedKind(option.kind)}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate">{option.label}</span>
                <Icon
                  name="Check"
                  className={cn(
                    "size-3.5 shrink-0",
                    option.kind === activeSection.kind
                      ? "opacity-100"
                      : "opacity-0",
                  )}
                />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
      {aggregate}
    </span>
  ) : (
    <span className="flex items-baseline gap-x-3">
      <span className="min-w-[var(--detail-label-width,96px)] truncate">
        {activeSection.label}
      </span>
      {aggregate}
    </span>
  );

  return (
    <DetailRow
      label={label}
      orientation="vertical"
      className={rowClassName}
      labelClassName={labelClassName}
      valueClassName={rowValueClassName}
    >
      <WorkspaceChangesList
        files={activeSection.files}
        className={listClassName}
        limit={limit}
        onFileClick={
          onFileClick
            ? (file) => onFileClick({ file, section: activeSection })
            : undefined
        }
      />
    </DetailRow>
  );
}
