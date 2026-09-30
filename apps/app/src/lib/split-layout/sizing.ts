export const PANE_MIN_WIDTH_PX = 240;

export function splitWidthLimits(
  width: number,
  leadingMinimum = PANE_MIN_WIDTH_PX,
  trailingMinimum = PANE_MIN_WIDTH_PX,
) {
  const total = leadingMinimum + trailingMinimum;
  const available = Math.max(width, total);
  return {
    min: leadingMinimum / available,
    max: 1 - trailingMinimum / available,
  };
}
