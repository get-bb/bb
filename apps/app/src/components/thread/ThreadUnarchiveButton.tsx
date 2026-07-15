import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

export function ThreadUnarchiveButton({
  isPending,
  onUnarchive,
  buttonLabel,
  className,
  variant = "icon",
}: {
  isPending?: boolean;
  onUnarchive: () => void;
  buttonLabel?: string;
  className?: string;
  variant?: "icon" | "secondary";
}) {
  const resolvedLabel = buttonLabel ?? "Unarchive thread";
  const isSecondary = variant === "secondary";
  return (
    <Button
      type="button"
      variant={isSecondary ? "secondary" : "ghost"}
      size={isSecondary ? undefined : "icon"}
      aria-label={resolvedLabel}
      onClick={onUnarchive}
      disabled={Boolean(isPending)}
      className={cn(
        isSecondary ? "h-7 shrink-0 px-2.5 text-xs font-normal" : "size-6",
        className,
      )}
    >
      {isSecondary ? (
        isPending ? (
          "Restoring…"
        ) : (
          "Unarchive"
        )
      ) : isPending ? (
        <Icon name="Spinner" className="size-3 animate-spin" />
      ) : (
        <Icon name="ArchiveRestore" className="size-3" />
      )}
    </Button>
  );
}
