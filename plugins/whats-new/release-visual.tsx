import { cn } from "@/lib/utils";
import { GRID, INK } from "./release-art-kit.js";
import {
  RELEASE_VISUALS,
  TONE_COLOR,
  type ReleaseVisualId,
} from "./release-visuals.js";

export function isReleaseVisualId(value: string): value is ReleaseVisualId {
  return Object.hasOwn(RELEASE_VISUALS, value);
}

export function ReleaseVisual({
  visual,
  className,
}: {
  visual: string | null;
  className?: string;
}) {
  if (visual === null || !isReleaseVisualId(visual)) {
    return null;
  }
  const { tone, draw } = RELEASE_VISUALS[visual];
  return (
    <svg
      aria-hidden
      focusable="false"
      data-release-visual={visual}
      viewBox={`0 0 ${GRID} ${GRID}`}
      className={cn("size-16 shrink-0", className)}
      style={{ color: INK }}
    >
      {draw(TONE_COLOR[tone])}
    </svg>
  );
}
