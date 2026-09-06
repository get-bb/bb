import { useCallback, useEffect, useMemo, useState } from "react";
import type { PluginBrowserActionProps } from "@get-bb/plugin-sdk";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { PluginSlotMount } from "./PluginSlotMount";
import {
  usePluginSlots,
  type PluginBrowserActionSlot,
} from "@/lib/plugin-slots";
const BROWSER_CORE_CHROME_RESERVE_PX = 300;
const BROWSER_ACTION_FOOTPRINT_PX = 32;

interface PluginBrowserActionsProps {
  chromeWidth: number | null;
  tabId: string;
  navigationEpoch: number | null;
  threadId: string | null;
  projectId: string | null;
  url: string;
  onOverlayLeaseChange(owner: symbol, open: boolean): void;
}

interface BrowserActionSlotRuntimeProps extends PluginBrowserActionProps {
  slot: PluginBrowserActionSlot;
}

function BrowserActionSlotRuntime({
  slot,
  ...props
}: BrowserActionSlotRuntimeProps) {
  const Component = slot.component;
  return <Component {...props} />;
}

function BrowserActionMount({
  slot,
  mountIdentity,
  ...runtimeProps
}: BrowserActionSlotRuntimeProps & { mountIdentity: string }) {
  return (
    <PluginSlotMount
      key={`${slot.pluginId}/${slot.id}/${slot.generation}/${mountIdentity}`}
      pluginId={slot.pluginId}
      slotKind="browserAction"
      slotId={slot.id}
      instanceId={runtimeProps.tabId}
      crashFallback={null}
    >
      <span role="group" aria-label={slot.title} className="flex shrink-0">
        <BrowserActionSlotRuntime slot={slot} {...runtimeProps} />
      </span>
    </PluginSlotMount>
  );
}

export function browserActionInlineCount(
  actionCount: number,
  chromeWidth: number | null,
) {
  if (chromeWidth === null) return actionCount;
  const slots = Math.max(
    1,
    Math.floor(
      (chromeWidth - BROWSER_CORE_CHROME_RESERVE_PX) /
        BROWSER_ACTION_FOOTPRINT_PX,
    ),
  );
  return actionCount <= slots ? actionCount : Math.max(0, slots - 1);
}

export function PluginBrowserActions({
  chromeWidth,
  tabId,
  navigationEpoch,
  threadId,
  projectId,
  url,
  onOverlayLeaseChange,
}: PluginBrowserActionsProps) {
  const { browserActions } = usePluginSlots();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowOwner = useMemo(() => Symbol("browser-action-overflow"), []);
  const inlineCount = browserActionInlineCount(
    browserActions.length,
    chromeWidth,
  );
  const inline = browserActions.slice(0, inlineCount);
  const overflow = browserActions.slice(inlineCount);
  const mountIdentity = `${tabId}:${threadId ?? ""}:${projectId ?? ""}:${url}`;
  const runtimeProps: PluginBrowserActionProps = {
    tabId,
    navigationEpoch,
    threadId,
    projectId,
    url,
  };

  const handleOverflowOpenChange = useCallback(
    (open: boolean) => {
      setOverflowOpen(open);
      onOverlayLeaseChange(overflowOwner, open);
    },
    [onOverlayLeaseChange, overflowOwner],
  );

  useEffect(() => {
    return () => onOverlayLeaseChange(overflowOwner, false);
  }, [onOverlayLeaseChange, overflowOwner]);

  useEffect(() => {
    if (overflow.length === 0 && overflowOpen) {
      handleOverflowOpenChange(false);
    }
  }, [handleOverflowOpenChange, overflow.length, overflowOpen]);

  if (browserActions.length === 0) return null;

  return (
    <div
      data-testid="plugin-browser-actions"
      className="flex shrink-0 items-center gap-1"
    >
      {inline.map((slot) => (
        <BrowserActionMount
          key={`${slot.pluginId}/${slot.id}/${slot.generation}/${mountIdentity}`}
          slot={slot}
          mountIdentity={mountIdentity}
          {...runtimeProps}
        />
      ))}
      {overflow.length > 0 ? (
        <DropdownMenu
          open={overflowOpen}
          onOpenChange={handleOverflowOpenChange}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`More Browser actions (${overflow.length})`}
              className={cn(
                "flex shrink-0 items-center justify-center transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
                CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
              )}
            >
              <Icon name="MoreHorizontal" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48 p-1.5">
            <div
              className="space-y-0.5"
              role="group"
              aria-label="Browser actions"
            >
              {overflow.map((slot) => (
                <div
                  key={`${slot.pluginId}/${slot.id}/${slot.generation}/${mountIdentity}`}
                  className="flex h-9 items-center gap-3 rounded-md px-2 text-sm text-foreground"
                >
                  <span className="min-w-0 flex-1 truncate">{slot.title}</span>
                  <BrowserActionMount
                    slot={slot}
                    mountIdentity={mountIdentity}
                    {...runtimeProps}
                  />
                </div>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
