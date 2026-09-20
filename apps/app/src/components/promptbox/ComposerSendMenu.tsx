import { useState, type ReactNode } from "react";
import { DropdownMenuItem } from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { CompactLongPressMenu } from "@/components/ui/compact-long-press-menu";
import { PluginComposerPlusMenuEntry } from "@/components/plugin/PluginComposerActions";
import { useResolvedComposerPlusMenuItems } from "@/components/plugin/composer-slot-hooks";
import { useOptionalPluginComposerView } from "@/components/plugin/plugin-composer-host";

export function ComposerSendMenu({
  children,
  enabled,
  includePluginContributions,
  queue,
  canSubmit,
  onSubmit,
}: {
  children: ReactNode;
  enabled: boolean;
  includePluginContributions: boolean;
  queue: boolean;
  canSubmit: boolean;
  onSubmit: (() => void) | undefined;
}) {
  const view = useOptionalPluginComposerView();
  const contributions = useResolvedComposerPlusMenuItems(
    enabled && includePluginContributions ? (view?.scope.kind ?? null) : null,
  ).filter((contribution) => contribution.item.experimental_sendMenu === true);
  const [open, setOpen] = useState(false);

  if (!enabled || (!onSubmit && contributions.length === 0)) return children;

  return (
    <CompactLongPressMenu
      label="Send options"
      onOpenChange={setOpen}
      items={
        <>
          {onSubmit ? (
            <DropdownMenuItem disabled={!canSubmit} onSelect={onSubmit}>
              <Icon
                name={queue ? "ListEnd" : "Sent"}
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
      }
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
