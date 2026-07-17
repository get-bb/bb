import { cn } from "@bb/shared-ui/lib/utils";

// Intentionally local: this is a full-region centered zero state (column
// layout, generous padding, text-sm), unlike @bb/shared-ui/empty-state's
// inline hint (EmptyState) or dashed-border box (EmptyStatePanel).
export function EmptyState({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 px-6 py-12 text-center",
        className,
      )}
    >
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
