import type { PaletteModeRegistration } from "./palette-mode";
import { ThreadSearchPaletteMode } from "@/components/commands/ThreadSearchPaletteMode";

export const PALETTE_MODES: readonly PaletteModeRegistration[] = [
  {
    id: "thread-search",
    entryCommand: "thread.search",
    chip: { icon: "Search", label: "Threads" },
    placeholder: "Search title, project, or message…",
    footerKeys: [
      { keys: ["⌘↵"], label: "Split" },
      { keys: ["Esc"], label: "Back" },
    ],
    inputDescription:
      "Use Command-Enter or Control-Enter to open the selected thread in a split. Use Escape to return to commands.",
    View: ThreadSearchPaletteMode,
  },
];

export const PALETTE_MODE_ENTRY_COMMANDS = PALETTE_MODES.map(
  (mode) => mode.entryCommand,
);
