import { cn } from "@bb/shared-ui/lib/utils";
import type { MiniMapSlot } from "./threadSplitIndicator";

const GLYPH_SIZE = 14;
const GLYPH_PADDING = 1;
const INNER = GLYPH_SIZE - 2 * GLYPH_PADDING;
const OUTLINE_WIDTH = 1;

interface ThreadRowMiniMapProps {
  slots: MiniMapSlot[];
  label: string;
}

// Position a normalized [0,1] value onto the padded glyph canvas.
function offset(value: number): number {
  return GLYPH_PADDING + value * INNER;
}

function extent(value: number): number {
  return value * INNER;
}

// SVG strokes are centered on a rect's edge. Inset outlined slots by half the
// stroke so their visible bounds match the filled slot bounds exactly.
function outlineInset(isFilled: boolean): number {
  return isFilled ? 0 : OUTLINE_WIDTH / 2;
}

/**
 * Tiny outline of the current pane arrangement drawn at a sidebar row's trailing
 * edge, with this thread's slot filled and the focused pane's slot in the accent
 * token. Colors come from theme tokens (stroke/fill utilities), never hardcoded,
 * so custom palettes re-anchor cleanly. Sits left of the hover-action slot so it
 * never fights the row's revealed actions.
 */
export function ThreadRowMiniMap({ slots, label }: ThreadRowMiniMapProps) {
  return (
    <svg
      width={GLYPH_SIZE}
      height={GLYPH_SIZE}
      viewBox={`0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`}
      className="pointer-events-none ml-0.5 shrink-0"
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
    >
      {slots.map((slot) => {
        const inset = outlineInset(slot.isMe);
        return (
          <rect
            key={slot.paneId}
            x={offset(slot.rect.x) + inset}
            y={offset(slot.rect.y) + inset}
            width={Math.max(extent(slot.rect.w) - 2 * inset, 0)}
            height={Math.max(extent(slot.rect.h) - 2 * inset, 0)}
            strokeWidth={slot.isMe ? 0 : OUTLINE_WIDTH}
            className={cn(
              slot.isMe
                ? slot.isFocused
                  ? "fill-primary/70 stroke-none"
                  : "fill-muted-foreground/45 stroke-none"
                : "fill-none stroke-muted-foreground/30",
            )}
          />
        );
      })}
    </svg>
  );
}
