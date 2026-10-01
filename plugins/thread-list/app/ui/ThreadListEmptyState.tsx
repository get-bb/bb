import { EmptyState } from "@/components/ui/empty-state";

export const NO_THREADS_MESSAGE = "No threads";

export function ThreadListEmptyState({
  message = NO_THREADS_MESSAGE,
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <EmptyState
      message={message}
      icon="MessageSquare"
      className={className}
      iconClassName="size-3.5 text-subtle-foreground/50"
      messageClassName="text-xs leading-4 text-subtle-foreground/60"
    />
  );
}
