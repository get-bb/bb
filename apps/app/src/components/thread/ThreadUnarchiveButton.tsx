import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";

export function ThreadUnarchiveButton({
  isPending,
  onUnarchive,
  variant = "icon",
}: {
  isPending?: boolean;
  onUnarchive: () => void;
  variant?: "icon" | "secondary";
}) {
  const isSecondary = variant === "secondary";
  return (
    <Button
      type="button"
      variant={isSecondary ? "secondary" : "ghost"}
      size={isSecondary ? undefined : "icon"}
      aria-label="Unarchive thread"
      onClick={onUnarchive}
      disabled={Boolean(isPending)}
      className={
        isSecondary ? "h-7 shrink-0 px-2.5 text-xs font-normal" : "size-6"
      }
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
