import type { DesktopBrowserImportSource } from "@bb/host-daemon-contract";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

export function BrowserSourceIcon({
  source,
  className,
}: {
  source: Pick<DesktopBrowserImportSource, "name" | "icon">;
  className?: string;
}) {
  if (source.icon) {
    return (
      <img
        src={source.icon}
        alt=""
        aria-hidden
        draggable={false}
        className={cn("shrink-0 object-contain", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center bg-muted/60 text-subtle-foreground",
        className,
      )}
    >
      <Icon name="Globe" className="size-[60%]" />
    </span>
  );
}
