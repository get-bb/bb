import type { SFSymbol } from "sf-symbols-typescript";
import type { IconName } from "./icon-map";

export type { SFSymbol };

export const SF_SYMBOL_WEIGHTS = {
  ultralight: "100",
  thin: "200",
  light: "300",
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  heavy: "800",
  black: "900",
} as const;

export type SFSymbolWeight = keyof typeof SF_SYMBOL_WEIGHTS;

export const SF_SYMBOL_WEIGHT: SFSymbolWeight = "medium";

export const SF_SYMBOL_MAP = {
  AlertTriangle: "exclamationmark.triangle",
  ArrowRight: "arrow.right",
  ArrowReloadHorizontal: "arrow.triangle.2.circlepath",
  Check: "checkmark",
  ChevronRight: "chevron.right",
  CircleCheck: "checkmark.circle",
  CircleX: "xmark.circle",
  Cloud: "cloud",
  Eye: "eye",
  Globe: "globe",
  GridView: "square.grid.2x2",
  Info: "info.circle",
  Laptop: "laptopcomputer",
  Loading: "circle.dotted",
  Lock: "lock",
  Palette: "paintpalette",
  Plus: "plus",
  RotateCcw: "arrow.clockwise",
  Settings: "gearshape",
  Smartphone: "iphone",
  Trash2: "trash",
  Zap: "bolt",
} as const satisfies Partial<Record<IconName, SFSymbol>>;

const SYMBOL_BY_NAME: Partial<Record<IconName, SFSymbol>> = SF_SYMBOL_MAP;

export function sfSymbolFor(name: IconName): SFSymbol | undefined {
  return SYMBOL_BY_NAME[name];
}
