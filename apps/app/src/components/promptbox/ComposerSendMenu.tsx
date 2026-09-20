import { useState, type ReactNode } from "react";
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
import { CompactLongPressMenu } from "@/components/ui/compact-long-press-menu";
import { PluginComposerPlusMenuEntry } from "@/components/plugin/PluginComposerActions";
import { useResolvedComposerPlusMenuItems } from "@/components/plugin/composer-slot-hooks";
import { useOptionalPluginComposerView } from "@/components/plugin/plugin-composer-host";

export function ComposerSendMenu({
  children,
  isPointerCoarse,
  includePluginContributions,
  queue,
  hasInput,
  canSubmit,
  onSubmit,
}: {
  children: ReactNode;
  isPointerCoarse: boolean;
  includePluginContributions: boolean;
  queue: boolean;
  hasInput: boolean;
  canSubmit: boolean;
  onSubmit: (() => void) | undefined;
}) {
  const isCompactViewport = useIsCompactViewport();
  const view = useOptionalPluginComposerView();
  const contributions = useResolvedComposerPlusMenuItems(
    includePluginContributions ? (view?.scope.kind ?? null) : null,
  ).filter((contribution) => contribution.item.experimental_sendMenu === true);
  const [open, setOpen] = useState(false);

  if (!onSubmit && contributions.length === 0) return children;

  const items = (
    <>
      {onSubmit ? (
        <DropdownMenuItem disabled={!canSubmit} onSelect={onSubmit}>
          <Icon
            name={queue ? "ListEnd" : "CornerDownRight"}
            className={cn("size-4", queue && "-scale-x-100")}
          />
          {queue ? "Queue" : "Steer"}
        </DropdownMenuItem>
      ) : null}
      {contributions.map((contribution) => (
        <PluginComposerPlusMenuEntry
          key={contribution.key}
          contribution={contribution}
        />
      ))}
    </>
  );

  if (isPointerCoarse && isCompactViewport) {
    return (
      <CompactLongPressMenu
        label="Send options"
        onOpenChange={setOpen}
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
    <div className="inline-flex items-center [&_[data-promptbox-submit-action]]:rounded-r-none">
      {children}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant={hasInput ? "default" : "ghost"}
            aria-label="Send options"
            className={cn(
              "relative w-7 rounded-l-none px-0 before:absolute before:left-0 before:top-1/2 before:h-3 before:w-px before:-translate-y-1/2 [&_[data-icon-root]]:size-2.5",
              hasInput
                ? "before:bg-background/25"
                : "text-muted-foreground before:bg-border",
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
