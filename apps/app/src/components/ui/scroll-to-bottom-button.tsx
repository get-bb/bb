import { cn } from "@bb/shared-ui/lib/utils";
import { Icon } from "@bb/shared-ui/icon";

export interface ScrollToBottomButtonProps {
  visible: boolean;
  active?: boolean;
  onClick: () => void;
  className?: string;
  ariaLabel?: string;
}

export function ScrollToBottomButton({
  visible,
  active = false,
  onClick,
  className,
  ariaLabel = "Scroll to latest event",
}: ScrollToBottomButtonProps) {
  return (
    <div className={cn("flex h-0 items-center justify-center", className)}>
      <button
        onClick={onClick}
        className={cn(
          // Opaque fill, no backdrop-filter: the button stays mounted over the
          // streaming timeline, and a blur there costs a compositing pass per
          // frame. `hover:bg-accent` is the opaque hover step; the translucent
          // `state-hover` token would let timeline text show through now
          // that nothing blurs it. While hidden the button is `invisible` so
          // its fade-out end state is skipped by paint and hit testing.
          "z-20 -mt-20 flex size-8 cursor-pointer items-center justify-center rounded-full border border-border bg-background transition-all duration-200 hover:bg-accent",
          visible
            ? "translate-y-0 opacity-100"
            : "pointer-events-none invisible translate-y-2 opacity-0",
        )}
        aria-label={ariaLabel}
        type="button"
      >
        {/* One control — the down-arrow. While the thread is active it shimmers
            (like the "Thinking..." indicator) to signal live content below;
            idle is the static arrow. The sweep only runs while the button is
            shown: at the bottom of a streaming thread the hidden button would
            otherwise repaint its shimmer every frame at opacity 0. */}
        <Icon
          name="ArrowDown"
          className={cn("size-4", active && visible && "animate-shine-icon")}
        />
      </button>
    </div>
  );
}
