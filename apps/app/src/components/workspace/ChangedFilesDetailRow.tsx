import { DetailRow } from "@bb/shared-ui/detail-card";
import { WorkspaceChangesList } from "bb-plugin-bb--git/WorkspaceChangesList";
import {
  renderChangeSummary,
  toChangeTally,
  type WorkspaceChangedFilesSection,
} from "bb-plugin-bb--git/workspace-change-summary";

interface ChangedFilesDetailRowProps {
  section: WorkspaceChangedFilesSection;
  listClassName?: string;
  rowClassName?: string;
  rowValueClassName?: string;
}

export function ChangedFilesDetailRow({
  section,
  listClassName,
  rowClassName,
  rowValueClassName,
}: ChangedFilesDetailRowProps) {
  return (
    <DetailRow
      label={
        <span className="flex items-baseline gap-x-3">
          <span className="min-w-[var(--detail-label-width,96px)] truncate">
            {section.label}
          </span>
          <span className="truncate text-muted-foreground">
            {renderChangeSummary(toChangeTally(section.stats))}
          </span>
        </span>
      }
      orientation="vertical"
      className={rowClassName}
      valueClassName={rowValueClassName}
    >
      <WorkspaceChangesList
        files={section.files}
        fileCount={section.stats.fileCount}
        className={listClassName}
      />
    </DetailRow>
  );
}
