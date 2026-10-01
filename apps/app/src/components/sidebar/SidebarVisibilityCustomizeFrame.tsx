import type { ReactNode, RefObject } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { COARSE_POINTER_ROW_ACTION_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { cn } from "@bb/shared-ui/lib/utils";

export function SidebarVisibilityCustomizeFrame({
  autoFocusDone = false,
  children,
  containerRef,
  doneButtonRef,
  onDone,
  testId,
  title,
  variant,
}: {
  autoFocusDone?: boolean;
  children: ReactNode;
  containerRef?: RefObject<HTMLDivElement | null>;
  doneButtonRef?: RefObject<HTMLButtonElement | null>;
  onDone: () => void;
  testId?: string;
  title: string;
  variant: "compact" | "card";
}) {
  if (variant === "compact") {
    return (
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 flex-col"
        data-testid={testId}
      >
        <div className="flex shrink-0 items-center gap-1">
          <Button
            ref={doneButtonRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Back to sidebar"
            autoFocus={autoFocusDone}
            className={cn(
              COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
              "shrink-0 text-muted-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2",
            )}
            onClick={onDone}
          >
            <Icon name="ChevronLeft" aria-hidden="true" />
          </Button>
          <div
            className={cn("min-w-0 flex-1 px-1", CHROME_SECTION_LABEL_CLASS)}
          >
            {title}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pt-1">{children}</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="rounded-lg border border-sidebar-border/40 bg-sidebar-accent/40 p-1"
      data-testid={testId}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onDone();
      }}
    >
      <div className="flex items-center gap-1 pb-1">
        <div
          className={cn("min-w-0 flex-1 px-2 py-1", CHROME_SECTION_LABEL_CLASS)}
        >
          {title}
        </div>
        <Button
          ref={doneButtonRef}
          type="button"
          variant="ghost"
          size="sm"
          autoFocus={autoFocusDone}
          className="h-6 shrink-0 px-2 text-xs text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent focus-visible:ring-2"
          onClick={onDone}
        >
          Done
        </Button>
      </div>
      {children}
    </div>
  );
}
