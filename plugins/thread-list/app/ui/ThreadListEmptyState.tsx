import { EmptyState } from "@bb/shared-ui/empty-state";

export const NO_THREADS_MESSAGE = "No threads";

export function ThreadListEmptyState({
  message = NO_THREADS_MESSAGE,
  showIcon = true,
  className,
}: {
  message?: string;
  showIcon?: boolean;
  className?: string;
}) {
  return (
    <EmptyState
      message={message}
      icon={showIcon ? "MessageSquare" : undefined}
      className={className}
      iconClassName="size-3.5 text-subtle-foreground/50"
      messageClassName="text-xs leading-4 text-subtle-foreground/60"
    />
  );
}
