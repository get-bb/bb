import { cn } from "@bb/shared-ui/lib/utils";

export type OverflowFadePlacement = "above" | "below" | "left" | "right";
export type OverflowFadeTone = "background" | "sidebar";
export type OverflowFadeSize = "default" | "sm";

export interface OverflowFadeProps {
  className?: string;
  placement: OverflowFadePlacement;
  tone?: OverflowFadeTone;
  /**
   * Named size variants so the fade thickness stays sanctioned. For vertical
   * placements (`above`/`below`) the variant drives height + the matching
   * negative offset; for horizontal placements (`left`/`right`) it drives the
   * fade width. `default` is 1.5rem (page-level fades over body content); `sm`
   * is 0.5rem (sidebar fades where rows are short and a tall fade would mask
   * whole rows).
   */
  size?: OverflowFadeSize;
}

interface VerticalSizeClasses {
  height: string;
  aboveOffset: string;
  belowOffset: string;
}

const OVERFLOW_FADE_VERTICAL_SIZE_CLASSES: Record<
  OverflowFadeSize,
  VerticalSizeClasses
> = {
  default: {
    height: "h-6",
    aboveOffset: "-top-6",
    belowOffset: "-bottom-6",
  },
  sm: {
    height: "h-2",
    aboveOffset: "-top-2",
    belowOffset: "-bottom-2",
  },
};

const OVERFLOW_FADE_HORIZONTAL_WIDTH_CLASS: Record<OverflowFadeSize, string> = {
  default: "w-6",
  sm: "w-2",
};

function isHorizontalPlacement(placement: OverflowFadePlacement): boolean {
  return placement === "left" || placement === "right";
}

interface OverflowFadeGradientClasses {
  background: string;
  sidebar: string;
}

// Each fade runs transparent (content side) → surface color (outer edge). Both
// gradient stops are spelled out as full literals per placement+tone so
// Tailwind's content scanner keeps them — building `from-${color}` dynamically
// would purge the classes. Pairing the transparent and surface stops here (one
// `from-*`, one `to-*`) also prevents the collision where two `from-*` classes
// fight over one stop and leave the other unset, degenerating the gradient.
const OVERFLOW_FADE_GRADIENT_CLASSES: Record<
  OverflowFadePlacement,
  OverflowFadeGradientClasses
> = {
  above: {
    background: "bg-gradient-to-b from-transparent to-background",
    sidebar: "bg-gradient-to-b from-transparent to-sidebar",
  },
  below: {
    background: "bg-gradient-to-b to-transparent from-background",
    sidebar: "bg-gradient-to-b to-transparent from-sidebar",
  },
  left: {
    background: "bg-gradient-to-l from-transparent to-background",
    sidebar: "bg-gradient-to-l from-transparent to-sidebar",
  },
  right: {
    background: "bg-gradient-to-r from-transparent to-background",
    sidebar: "bg-gradient-to-r from-transparent to-sidebar",
  },
};

function getOverflowFadeGradientClass(
  placement: OverflowFadePlacement,
  tone: OverflowFadeTone,
): string {
  return OVERFLOW_FADE_GRADIENT_CLASSES[placement][tone];
}

function getOverflowFadeLayoutClasses(
  placement: OverflowFadePlacement,
  size: OverflowFadeSize,
): string {
  if (isHorizontalPlacement(placement)) {
    const widthClass = OVERFLOW_FADE_HORIZONTAL_WIDTH_CLASS[size];
    const sideClass = placement === "left" ? "left-0" : "right-0";
    return cn("inset-y-0", sideClass, widthClass);
  }

  const sizeClasses = OVERFLOW_FADE_VERTICAL_SIZE_CLASSES[size];
  const offsetClass =
    placement === "above" ? sizeClasses.aboveOffset : sizeClasses.belowOffset;
  return cn("inset-x-0", sizeClasses.height, offsetClass);
}

export function OverflowFade({
  className,
  placement,
  tone = "background",
  size = "default",
}: OverflowFadeProps) {
  return (
    <div
      aria-hidden
      data-overflow-fade={placement}
      data-overflow-fade-tone={tone}
      className={cn(
        "pointer-events-none absolute",
        getOverflowFadeLayoutClasses(placement, size),
        getOverflowFadeGradientClass(placement, tone),
        className,
      )}
    />
  );
}
