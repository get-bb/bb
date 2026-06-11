import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon.js";

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
          "z-20 -mt-20 flex size-8 items-center justify-center transition-all duration-200",
          // While the thread is active the shimmering download-circle IS the
          // affordance (the icon supplies the circle); the idle state keeps the
          // round scrim button + arrow.
          active
            ? "text-foreground"
            : "rounded-full border border-border bg-surface-scrim backdrop-blur-md hover:bg-state-hover",
          visible
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-2 opacity-0",
        )}
        aria-label={ariaLabel}
        type="button"
      >
        {active ? (
          <Icon
            name="DownloadCircle"
            className="size-7 animate-shine-icon"
            strokeWidth={1.2}
          />
        ) : (
          <Icon name="ArrowDown" className="size-4" />
        )}
      </button>
    </div>
  );
}
