import type { LayoutNode } from "./types";

export const PANE_MIN_WIDTH_PX = 240;
export const SPLIT_MIN_HEIGHT_FRACTION = 0.15;
export const SPLIT_MAX_HEIGHT_FRACTION = 1 - SPLIT_MIN_HEIGHT_FRACTION;

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

export function minimumSplitWidth(node: LayoutNode): number {
  if (node.type === "pane") return PANE_MIN_WIDTH_PX;
  const widths = node.children.map(minimumSplitWidth);
  return node.dir === "row"
    ? widths.reduce((sum, width) => sum + width, node.children.length - 1)
    : Math.max(...widths);
}

export function fitSplitWidths(node: LayoutNode, width: number): LayoutNode {
  if (node.type === "pane" || width <= 0) return node;
  const available = Math.max(0, width - (node.children.length - 1));
  const total = node.sizes.reduce((sum, value) => sum + value, 0);
  let sizes =
    Math.abs(total - 1) <= 1e-12
      ? node.sizes
      : node.sizes.map((value) => value / total);
  if (node.dir === "row" && available > 0) {
    const minimums = node.children.map(minimumSplitWidth);
    const minimumTotal = minimums.reduce((sum, value) => sum + value, 0);
    const floors = minimums.map(
      (value) => value / Math.max(available, minimumTotal),
    );
    const deficit = floors.reduce(
      (sum, floor, index) => sum + Math.max(0, floor - (sizes[index] ?? 0)),
      0,
    );
    if (deficit > 1e-9) {
      const slack = floors.reduce(
        (sum, floor, index) => sum + Math.max(0, (sizes[index] ?? 0) - floor),
        0,
      );
      sizes = floors.map((floor, index) => {
        const size = sizes[index] ?? 0;
        return size <= floor || slack <= deficit
          ? floor
          : size - (deficit * (size - floor)) / slack;
      });
    }
  }
  const children = node.children.map((child, index) =>
    fitSplitWidths(
      child,
      node.dir === "row" ? available * (sizes[index] ?? 0) : width,
    ),
  );
  return sizes === node.sizes &&
    children.every((child, index) => child === node.children[index])
    ? node
    : { ...node, sizes, children };
}
