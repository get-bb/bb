import type { PaletteModeRegistration } from "./palette-mode";
import { ThreadSearchPaletteMode } from "@/components/commands/ThreadSearchPaletteMode";

export const PALETTE_MODES: readonly PaletteModeRegistration[] = [
  {
    id: "thread-search",
    entryCommand: "thread.search",
    chip: { icon: "Search", label: "Threads" },
    placeholder: "Search threads",
    footerKeys: [
      { keys: "↑↓", label: "Select" },
      { keys: "↵", label: "Open" },
      { keys: "⌘↵", label: "Open in split" },
      { keys: "Esc", label: "Back" },
    ],
    View: ThreadSearchPaletteMode,
  },
];

export const PALETTE_MODE_ENTRY_COMMANDS = PALETTE_MODES.map(
  (mode) => mode.entryCommand,
);
