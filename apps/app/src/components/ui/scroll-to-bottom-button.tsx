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
          "z-20 -mt-20 flex size-8 cursor-pointer items-center justify-center rounded-full border border-border bg-surface-scrim backdrop-blur-md transition-all duration-200 hover:bg-state-hover",
          visible
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-2 opacity-0",
        )}
        aria-label={ariaLabel}
        type="button"
      >
        {/* One control — the down-arrow. While the thread is active it shimmers
            (like the "Thinking..." indicator) to signal live content below;
            idle is the static arrow. */}
        <Icon
          name="ArrowDown"
          className={cn("size-4", active && "animate-shine-icon")}
        />
      </button>
    </div>
  );
}
