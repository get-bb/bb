interface ArchivedThreadToastTitleProps {
  archivedThreadCount: number;
  onOpenThread: () => void;
  threadTitle: string;
}

function formatArchivedChildThreadSuffix(childThreadCount: number): string {
  if (childThreadCount <= 0) {
    return "";
  }
  return childThreadCount === 1
    ? " and 1 child thread"
    : ` and ${childThreadCount} child threads`;
}

export function ArchivedThreadToastTitle({
  archivedThreadCount,
  onOpenThread,
  threadTitle,
}: ArchivedThreadToastTitleProps) {
  return (
    <>
      <span className="inline-flex min-w-0 max-w-full items-baseline gap-1 overflow-hidden whitespace-nowrap">
        <span className="shrink-0">Archived</span>{" "}
        <button
          type="button"
          className="min-w-0 truncate underline underline-offset-2"
          title={threadTitle}
          onClick={onOpenThread}
        >
          {threadTitle}
        </button>
      </span>
      {formatArchivedChildThreadSuffix(archivedThreadCount - 1)}
    </>
  );
}
