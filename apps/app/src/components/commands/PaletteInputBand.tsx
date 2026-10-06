import type { ReactNode } from "react";

export const PALETTE_INPUT_CLASS =
  "min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle-foreground placeholder:font-light placeholder:opacity-70";

export function PaletteInputBand({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-t-[inherit] border-b border-border bg-background px-3 py-1"
      data-palette-input-band
    >
      <div className="flex h-10 items-center gap-2" data-palette-input-frame>
        {children}
      </div>
    </div>
  );
}

export const COMMAND_PALETTE_INPUT = {
  label: "Search commands",
  description: "Use Escape to close the command palette.",
  placeholder: "Search commands…",
};
