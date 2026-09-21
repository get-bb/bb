import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { CONTROL_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import { CompactLongPressMenu } from "@/components/ui/compact-long-press-menu";

export function ComposerSendMenu({
  children,
  isPointerCoarse,
  queue,
  hasInput,
  canSubmit,
  onSubmit,
}: {
  children: ReactNode;
  isPointerCoarse: boolean;
  queue: boolean;
  hasInput: boolean;
  canSubmit: boolean;
  onSubmit: (() => void) | undefined;
}) {
  const isCompactViewport = useIsCompactViewport();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!canSubmit) setOpen(false);
  }, [canSubmit]);
  const handleOpenChange = (nextOpen: boolean) => setOpen(nextOpen && canSubmit);

  if (!onSubmit) return children;

  const items = canSubmit ? (
    <DropdownMenuItem disabled={!canSubmit} onSelect={onSubmit}>
      <Icon
        name={queue ? "ListEnd" : "CornerDownRight"}
        className={cn("size-4", queue && "-scale-x-100")}
      />
      {queue ? "Queue" : "Steer"}
    </DropdownMenuItem>
  ) : null;

  if (isPointerCoarse && isCompactViewport) {
    if (!canSubmit) return children;
    return (
      <CompactLongPressMenu
        label="Send options"
        onOpenChange={handleOpenChange}
        items={items}
      >
        <span
          className="inline-flex"
          onPointerUpCapture={(event) => {
            if (!open) return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {children}
        </span>
      </CompactLongPressMenu>
    );
  }

  return (
    <div
      data-promptbox-send-menu=""
      className={cn(
        "ml-1 inline-flex items-center rounded-md [&_button]:border-0 [&_button]:!bg-transparent [&_button]:!text-inherit [&_button]:!opacity-100 [&_button]:transition-none [&_[data-promptbox-submit-action]]:ml-0 [&_[data-promptbox-submit-action]]:rounded-r-none",
        CONTROL_HOVER_TRANSITION,
        hasInput
          ? [
              "bg-foreground text-background",
              canSubmit ? "hover:bg-foreground/90" : "opacity-50",
            ]
          : "text-muted-foreground/50 ring-1 ring-inset ring-border",
      )}
    >
      {children}
      <DropdownMenu open={open && canSubmit} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Send options"
            disabled={!canSubmit}
            className={cn(
              "relative w-7 rounded-l-none px-0 before:absolute before:left-0 before:top-1/2 before:h-3 before:w-px before:-translate-y-1/2 [&_[data-icon-root]]:size-2.5",
              hasInput
                ? "before:bg-background/25"
                : "before:bg-border",
            )}
          >
            <Icon name="ChevronDown" className="opacity-80" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" mobileTitle="Send options">
          {items}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
