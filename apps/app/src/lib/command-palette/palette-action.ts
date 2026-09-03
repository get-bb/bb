import type { AppShortcutPresentation } from "@/lib/app-keybindings";

export const PALETTE_ACTION_BUCKETS = [
  "Threads",
  "Actions",
  "Plugins",
] as const;

export type PaletteActionBucket = (typeof PALETTE_ACTION_BUCKETS)[number];

export interface PaletteAction {
  id: string;
  bucket: PaletteActionBucket;
  group: string;
  title: string;
  shortcut: AppShortcutPresentation | null;
  run: () => void;
}
