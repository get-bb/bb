import { formatDiffCount } from "@bb/thread-view";
import { cn } from "@bb/shared-ui/lib/utils";

interface DiffStatsTallyProps {
  insertions: number;
  deletions: number;
  hideZero?: boolean;
  className?: string;
}

export function DiffStatsTally({
  insertions,
  deletions,
  hideZero = false,
  className,
}: DiffStatsTallyProps) {
  const showInsertions = !hideZero || insertions > 0;
  const showDeletions = !hideZero || deletions > 0;
  return (
    <span className={cn("whitespace-nowrap", className)}>
      {showInsertions ? (
        <span className="text-diff-added">+{formatDiffCount(insertions)}</span>
      ) : null}
      {showInsertions && showDeletions ? " " : null}
      {showDeletions ? (
        <span className="text-diff-removed">-{formatDiffCount(deletions)}</span>
      ) : null}
    </span>
  );
}

const DIFF_SIZE_BAR_BLOCKS = 5;

export function getDiffSizeBarBlocks({
  insertions,
  deletions,
}: {
  insertions: number;
  deletions: number;
}): { added: number; removed: number } {
  const total = insertions + deletions;
  if (total === 0) return { added: 0, removed: 0 };
  const filled = Math.min(
    DIFF_SIZE_BAR_BLOCKS,
    Math.max(1, Math.ceil(Math.log10(total + 1) * 2)),
  );
  const added = Math.round((insertions / total) * filled);
  return { added, removed: filled - added };
}

export function DiffSizeBar({
  insertions,
  deletions,
  className,
}: {
  insertions: number;
  deletions: number;
  className?: string;
}) {
  const { added, removed } = getDiffSizeBarBlocks({ insertions, deletions });
  return (
    <span className={cn("flex shrink-0 gap-px", className)} aria-hidden>
      {Array.from({ length: DIFF_SIZE_BAR_BLOCKS }, (_, index) => (
        <span
          key={index}
          className={cn(
            "size-1.5 rounded-[1px]",
            index < added
              ? "bg-diff-added"
              : index < added + removed
                ? "bg-diff-removed"
                : "bg-muted",
          )}
        />
      ))}
    </span>
  );
}
