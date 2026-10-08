import { cn } from "@bb/shared-ui/lib/utils";
import type { ReleaseVisualId } from "@bb/domain/changelog";
import { GRID, INK } from "./release-art-kit";
import { RELEASE_VISUALS, TONE_COLOR } from "./release-visuals";

export function ReleaseVisual({
  visual,
  className,
}: {
  visual: ReleaseVisualId | undefined;
  className?: string;
}) {
  if (visual === undefined) {
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
