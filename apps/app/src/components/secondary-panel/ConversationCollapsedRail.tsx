import { Icon } from "@/components/ui/icon.js";
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
  onExpand: () => void;
}

/**
 * The 48px vertical bar that stands in for the conversation when it is collapsed
 * so the secondary panel can fill the content area. The whole bar is the expand
 * affordance; it sits where the conversation was, between the sidebar and the
 * panel, and mirrors the mockup's slim labeled rail.
 */
export function ConversationCollapsedRail({
  collapsed,
  isWorking,
  onExpand,
}: ConversationCollapsedRailProps) {
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label="Expand conversation"
      aria-expanded={false}
      // Hidden from the a11y tree + tab order while the conversation is shown;
      // the rail only exists as a placeholder once collapsed.
      aria-hidden={collapsed ? undefined : true}
      inert={collapsed ? undefined : true}
      title="Expand conversation"
      className={cn(
        "group flex h-full shrink-0 flex-col items-center justify-between overflow-hidden bg-surface-recessed py-3 text-muted-foreground outline-none transition-[width,opacity] hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        PANEL_COLLAPSE_TRANSITION_CLASS,
        collapsed
          ? "w-12 opacity-100 delay-[40ms]"
          : "pointer-events-none w-0 opacity-0",
      )}
    >
      {/*
        Explicit chevron affordance at the top of the rail. Because the rail is
        itself the button, the icon is decorative — the button's aria-label
        ("Expand conversation") still carries the semantics for AT users — but
        the visible chevron makes the open action obvious instead of relying on
        the whole-bar hit area alone.
      */}
      <Icon
        name="ChevronRight"
        className="size-4 shrink-0"
        aria-hidden="true"
      />
      <span
        className="flex flex-1 items-center justify-center font-mono text-xs uppercase tracking-[0.2em] [writing-mode:vertical-rl] rotate-180"
        aria-hidden="true"
      >
        Conversation
      </span>
      <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
        {isWorking ? (
          <Icon name="CircleDashed" className="size-3.5 animate-spin" />
        ) : null}
      </span>
    </button>
  );
}
