export interface GroupedPlacement {
  group: string;
  order?: number;
}

export function compareGroupedPlacement(
  left: GroupedPlacement,
  leftIndex: number,
  right: GroupedPlacement,
  rightIndex: number,
): number {
  if (left.group !== right.group) return left.group < right.group ? -1 : 1;
  const leftOrder = left.order ?? Number.POSITIVE_INFINITY;
  const rightOrder = right.order ?? Number.POSITIVE_INFINITY;
  if (leftOrder !== rightOrder) return leftOrder < rightOrder ? -1 : 1;
  return leftIndex - rightIndex;
}
