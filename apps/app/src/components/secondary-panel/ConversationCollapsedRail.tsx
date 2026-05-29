import { Icon } from "@/components/ui/icon.js";
import { MACOS_WINDOW_DRAG_CLASS } from "@/lib/bb-desktop";
import { cn } from "@/lib/utils";
import { PANEL_COLLAPSE_TRANSITION_CLASS } from "./panelTransitionTokens";

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
 * The 36px vertical bar that stands in for the conversation when it is collapsed
 * so the secondary panel can fill the content area. The recessed body is the
 * expand affordance; it sits where the conversation was, between the sidebar and
 * the panel: an expand chevron on top and a chat glyph standing in for the
 * conversation below it.
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
          ? "w-9 opacity-100 delay-[40ms]"
          : "pointer-events-none w-0 opacity-0",
      )}
    >
      {reserveTopForDesktopTrafficLights ? (
        /*
          Transparent title-bar-height drag strip that anchors the recessed rail
          body below the macOS traffic-light cluster. It carries no
          `bg-surface-recessed`, so the red/yellow/green lights sit on clean
          window chrome instead of on top of the rail. Mirrors AppSidebar's top
          window-drag strip and matches the 48px (`h-12`) title-bar height the
          sidebar and secondary-panel chrome already use. This strip is the
          single mechanism that offsets the body below the lights — the chevron
          no longer carries its own top margin. Only rendered when the rail owns
          the top-left; on web / under an expanded sidebar the body fills the
          full height.
        */
        <div
          data-testid="conversation-collapsed-rail-traffic-light-strip"
          className={cn("h-12 shrink-0", MACOS_WINDOW_DRAG_CLASS)}
        />
      ) : null}
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expand conversation"
        aria-expanded={false}
        title="Expand conversation"
        className="flex min-h-0 w-full flex-1 flex-col items-center justify-between bg-surface-recessed py-3 text-muted-foreground outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {/*
          Explicit chevron affordance at the top of the recessed body. Because
          the body is itself the button, the icon is decorative — the button's
          aria-label ("Expand conversation") still carries the semantics for AT
          users — but the visible chevron makes the open action obvious instead
          of relying on the whole-bar hit area alone.
        */}
        <Icon name="ChevronRight" className="size-4 shrink-0" aria-hidden="true" />
        <span
          className="flex flex-1 items-center justify-center"
          aria-hidden="true"
        >
          <Icon name="MessageSquare" className="size-4 shrink-0" />
        </span>
        <span
          className="flex h-4 w-4 items-center justify-center"
          aria-hidden="true"
        >
          {isWorking ? (
            <Icon name="CircleDashed" className="size-3.5 animate-spin" />
          ) : null}
        </span>
      </button>
    </div>
  );
}
