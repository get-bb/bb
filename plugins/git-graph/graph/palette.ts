export const LANE_COLORS = [
  "#4f8ef7",
  "#e061c1",
  "#3fb950",
  "#d98500",
  "#a371f7",
  "#f0883e",
  "#2dd4bf",
  "#db61a2",
  "#9ece6a",
  "#7aa2f7",
] as const;

export const LANE_COLOR_COUNT = LANE_COLORS.length;

export function laneColor(colorIndex: number): string {
  return LANE_COLORS[
    ((colorIndex % LANE_COLOR_COUNT) + LANE_COLOR_COUNT) % LANE_COLOR_COUNT
  ];
}
