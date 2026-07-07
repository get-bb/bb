import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

export function ThreadUnarchiveButton({
  isPending,
  onUnarchive,
  buttonLabel,
  className,
}: {
  isPending?: boolean;
  onUnarchive: () => void;
  buttonLabel?: string;
  className?: string;
}) {
  const resolvedLabel = buttonLabel ?? "Unarchive thread";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={resolvedLabel}
      onClick={onUnarchive}
      disabled={Boolean(isPending)}
      className={cn("size-6", className)}
    >
      {isPending ? (
        <Icon name="Spinner" className="size-3 animate-spin" />
      ) : (
        <Icon name="ArchiveRestore" className="size-3" />
      )}
    </Button>
  );
}
