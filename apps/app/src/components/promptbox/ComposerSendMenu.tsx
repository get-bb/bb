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
  canSubmit,
  onSubmit,
}: {
  children: ReactNode;
  isPointerCoarse: boolean;
  includePluginContributions: boolean;
  queue: boolean;
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
            aria-label="Send options"
            title="Send options"
            className="rounded-l-none border-l border-background/20 px-1.5"
          >
            <Icon name="ChevronDown" className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" mobileTitle="Send options">
          {items}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
