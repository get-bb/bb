import type { ReactNode, RefObject } from "react";
import { Button } from "@bb/shared-ui/button";
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
          <div
            className={cn("min-w-0 flex-1 px-2", CHROME_SECTION_LABEL_CLASS)}
          >
            {title}
          </div>
          <Button
            ref={doneButtonRef}
            type="button"
            variant="ghost"
            size="sm"
            autoFocus={autoFocusDone}
            className="h-7 shrink-0 px-2 text-xs text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent focus-visible:ring-2 max-md:pointer-coarse:h-9 max-md:pointer-coarse:text-sm"
            onClick={onDone}
          >
            Done
          </Button>
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
