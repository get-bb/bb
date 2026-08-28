export type DetailScrollSize = "summary" | "base" | "delegation";

const DETAIL_SCROLL_MAX_HEIGHT_CLASS_BY_SIZE = {
  summary: "max-h-[240px]",
  base: "max-h-[288px]",
  delegation: "max-h-[768px]",
} satisfies Record<DetailScrollSize, string>;

export function getDetailScrollMaxHeightClass(size: DetailScrollSize): string {
  return DETAIL_SCROLL_MAX_HEIGHT_CLASS_BY_SIZE[size];
}
