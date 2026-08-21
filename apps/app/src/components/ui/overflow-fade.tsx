import { cn } from "@bb/shared-ui/lib/utils";

type OverflowFadePlacement = "above" | "below" | "left" | "right";
export type OverflowFadeTone = "background" | "sidebar" | "surface-raised";
type OverflowFadeSize = "default" | "sm";

interface OverflowFadeProps {
  className?: string;
  placement: OverflowFadePlacement;
  tone?: OverflowFadeTone;
  /**
   * Places a vertical fade inside the named edge of its containing block.
   * The default places vertical fades just outside the edge, which is useful
   * for fixed footers. Horizontal fades are already inset and are unchanged.
   */
  inset?: boolean;
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

function isHorizontalPlacement(
  placement: OverflowFadePlacement,
): placement is "left" | "right" {
  return placement === "left" || placement === "right";
}

interface OverflowFadeGradientClasses {
  background: string;
  sidebar: string;
  "surface-raised": string;
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
    "surface-raised":
      "bg-gradient-to-b from-transparent to-surface-raised-solid",
  },
  below: {
    background: "bg-gradient-to-b to-transparent from-background",
    sidebar: "bg-gradient-to-b to-transparent from-sidebar",
    "surface-raised":
      "bg-gradient-to-b to-transparent from-surface-raised-solid",
  },
  left: {
    background: "bg-gradient-to-l from-transparent to-background",
    sidebar: "bg-gradient-to-l from-transparent to-sidebar",
    "surface-raised":
      "bg-gradient-to-l from-transparent to-surface-raised-solid",
  },
  right: {
    background: "bg-gradient-to-r from-transparent to-background",
    sidebar: "bg-gradient-to-r from-transparent to-sidebar",
    "surface-raised":
      "bg-gradient-to-r from-transparent to-surface-raised-solid",
  },
};

const OVERFLOW_FADE_INSET_VERTICAL_GRADIENT_CLASSES: Record<
  "above" | "below",
  OverflowFadeGradientClasses
> = {
  above: {
    background: "bg-gradient-to-b from-background to-transparent",
    sidebar: "bg-gradient-to-b from-sidebar to-transparent",
    "surface-raised":
      "bg-gradient-to-b from-surface-raised-solid to-transparent",
  },
  below: {
    background: "bg-gradient-to-b from-transparent to-background",
    sidebar: "bg-gradient-to-b from-transparent to-sidebar",
    "surface-raised":
      "bg-gradient-to-b from-transparent to-surface-raised-solid",
  },
};

function getOverflowFadeGradientClass(
  placement: OverflowFadePlacement,
  tone: OverflowFadeTone,
  inset: boolean,
): string {
  if (inset && !isHorizontalPlacement(placement)) {
    return OVERFLOW_FADE_INSET_VERTICAL_GRADIENT_CLASSES[placement][tone];
  }
  return OVERFLOW_FADE_GRADIENT_CLASSES[placement][tone];
}

function getOverflowFadeLayoutClasses(
  placement: OverflowFadePlacement,
  size: OverflowFadeSize,
  inset: boolean,
): string {
  if (isHorizontalPlacement(placement)) {
    const widthClass = OVERFLOW_FADE_HORIZONTAL_WIDTH_CLASS[size];
    const sideClass = placement === "left" ? "left-0" : "right-0";
    return cn("inset-y-0", sideClass, widthClass);
  }

  const sizeClasses = OVERFLOW_FADE_VERTICAL_SIZE_CLASSES[size];
  const offsetClass = inset
    ? placement === "above"
      ? "top-0"
      : "bottom-0"
    : placement === "above"
      ? sizeClasses.aboveOffset
      : sizeClasses.belowOffset;
  return cn("inset-x-0", sizeClasses.height, offsetClass);
}

export function OverflowFade({
  className,
  placement,
  tone = "background",
  inset = false,
  size = "default",
}: OverflowFadeProps) {
  return (
    <div
      aria-hidden
      data-overflow-fade={placement}
      data-overflow-fade-tone={tone}
      data-overflow-fade-inset={inset ? "" : undefined}
      className={cn(
        "pointer-events-none absolute",
        getOverflowFadeLayoutClasses(placement, size, inset),
        getOverflowFadeGradientClass(placement, tone, inset),
        className,
      )}
    />
  );
}
