import { Icon } from "@bb/shared-ui/icon";
import {
  CHROME_ROW_HEIGHT_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
} from "@/lib/bb-desktop";
import { cn } from "@bb/shared-ui/lib/utils";
import { PANEL_COLLAPSE_TRANSITION_CLASS } from "./panelTransitionTokens";
import { resolveConversationCollapseControl } from "./panelToggleControlState";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";

interface ConversationCollapsedRailProps {
  /**
   * Whether the conversation is collapsed. The rail is the visible placeholder
   * in that state; when expanded it animates to zero width and drops out of the
   * tab order + a11y tree (the full conversation is the interactive surface).
   */
  collapsed: boolean;
  /** Surfaces a live "working" signal so the tucked-away conversation still shows state. */
  isWorking: boolean;
  /**
   * When true, reserve a transparent title-bar-height strip at the top of the
   * rail so the macOS traffic lights sit on clean window chrome instead of on
   * top of the rail's recessed background. Set by the parent only when the rail
   * is actually the top-left-most surface (desktop macOS + main sidebar
   * collapsed).
   */
  reserveTopForDesktopTrafficLights: boolean;
  onExpand: () => void;
}

/**
 * A quiet 32px placeholder for the collapsed conversation. It preserves the
 * spatial relationship between the sidebar and full-width panel without adding
 * another full-height filled surface. The explicit panel-open glyph at the top
 * restores the conversation; a working state becomes a compact badge on it.
 *
 * When the rail is the top-left-most surface on macOS desktop, a transparent
 * window-drag strip is reserved above the recessed body (mirroring AppSidebar's
 * top strip) so the traffic lights render on the title-bar chrome rather than on
 * top of the rail.
 */
export function ConversationCollapsedRail({
  collapsed,
  isWorking,
  reserveTopForDesktopTrafficLights,
  onExpand,
}: ConversationCollapsedRailProps) {
  const restoreControl = resolveConversationCollapseControl({
    isConversationCollapsed: true,
    onToggleConversationCollapse: onExpand,
  });

  return (
    <div
      // Hidden from the a11y tree + tab order (and made non-interactive) while
      // the conversation is shown; the rail only exists as a placeholder once
      // collapsed. Applied to the whole rail so the drag strip drops out too.
      aria-hidden={collapsed ? undefined : true}
      inert={collapsed ? undefined : true}
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden transition-[width,opacity]",
        PANEL_COLLAPSE_TRANSITION_CLASS,
        collapsed
          ? "w-8 opacity-100 delay-[40ms]"
          : "pointer-events-none w-0 opacity-0",
      )}
    >
      {reserveTopForDesktopTrafficLights ? (
        /*
          Transparent title-bar-height drag strip that anchors the recessed rail
          body below the macOS traffic-light cluster. It carries no
          `bg-surface-recessed`, so the red/yellow/green lights sit on clean
          window chrome instead of on top of the rail. Mirrors AppSidebar's top
          window-drag strip and matches the title-bar height shared across the
          chrome (`CHROME_ROW_HEIGHT_CLASS`). This strip is the single mechanism
          that offsets the body below the lights — the recessed body carries no
          top margin of its own. Only rendered when the rail owns the top-left;
          on web / under an expanded sidebar the body fills the full height.
        */
        <div
          data-testid="conversation-collapsed-rail-traffic-light-strip"
          className={cn(
            CHROME_ROW_HEIGHT_CLASS,
            "shrink-0",
            MACOS_WINDOW_DRAG_CLASS,
          )}
        />
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={restoreControl.onClick}
            aria-label={restoreControl.label}
            aria-expanded={restoreControl.isExpanded}
            className={cn(
              CHROME_ROW_HEIGHT_CLASS,
              "relative flex w-full shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            )}
          >
            <Icon
              name={restoreControl.iconName}
              className="size-4 shrink-0"
              aria-hidden="true"
            />
            {isWorking ? (
              <span
                className="absolute bottom-1 right-1 flex size-2.5 items-center justify-center rounded-full bg-background"
                aria-hidden="true"
              >
                <Icon name="CircleDashed" className="size-2.5 animate-spin" />
              </span>
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{restoreControl.label}</TooltipContent>
      </Tooltip>
    </div>
  );
}
