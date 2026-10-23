import { cn } from "@bb/shared-ui/lib/utils";
import {
  DETAIL_LABEL_CLASS,
  DETAIL_VALUE_CLASS,
} from "@/components/ui/detail-card.js";
import { WorkspaceChangesList } from "@bb/shared-ui/workspace-changes-list";
import {
  renderChangeSummary,
  toChangeTally,
  type WorkspaceChangedFilesSection,
} from "@bb/shared-ui/workspace-change-summary";

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
    <div className={cn("flex flex-col gap-1 py-0.5", rowClassName)}>
      <dt className={DETAIL_LABEL_CLASS}>
        <span className="flex items-baseline gap-x-3">
          <span className="min-w-[var(--detail-label-width,96px)] truncate">
            {section.label}
          </span>
          <span className="truncate text-muted-foreground">
            {renderChangeSummary(toChangeTally(section.stats))}
          </span>
        </span>
      </dt>
      <dd className={cn(DETAIL_VALUE_CLASS, rowValueClassName)}>
        <WorkspaceChangesList
          files={section.files}
          fileCount={section.stats.fileCount}
          className={listClassName}
        />
      </dd>
    </div>
  );
}
