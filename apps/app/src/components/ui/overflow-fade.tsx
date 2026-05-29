import { cn } from "@/lib/utils";

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

function getOverflowFadeToneClass(
  placement: OverflowFadePlacement,
  tone: OverflowFadeTone,
): string {
  // The fade always lands on the surface side: `above`/`left` fade *to* the
  // surface (content first), `below`/`right` fade *from* the surface.
  const startsAtSurface = placement === "below" || placement === "right";
  if (startsAtSurface) {
    return tone === "background" ? "from-background" : "from-sidebar";
  }

  return tone === "background" ? "to-background" : "to-sidebar";
}

function getOverflowFadeGradientClass(
  placement: OverflowFadePlacement,
): string {
  switch (placement) {
    case "above":
      return "bg-gradient-to-b from-transparent";
    case "below":
      return "bg-gradient-to-b to-transparent";
    case "left":
      return "bg-gradient-to-l from-transparent";
    case "right":
      return "bg-gradient-to-r from-transparent";
  }
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
        getOverflowFadeGradientClass(placement),
        getOverflowFadeToneClass(placement, tone),
        className,
      )}
    />
  );
}
