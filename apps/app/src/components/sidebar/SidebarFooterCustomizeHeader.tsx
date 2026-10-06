import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";

export function SidebarFooterCustomizeHeader({
  onDone,
  autoFocus = false,
}: {
  onDone: () => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex items-center gap-1 px-1 pb-1">
      <div
        className={cn("min-w-0 flex-1 px-2 py-1", CHROME_SECTION_LABEL_CLASS)}
      >
        Customize footer
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 px-2 text-xs text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent focus-visible:ring-2"
        onClick={onDone}
        autoFocus={autoFocus}
      >
        Done
      </Button>
    </div>
  );
}
