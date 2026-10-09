import type { ReactNode } from "react";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { PALETTE_INPUT_CLASS, PaletteInputBand } from "./PaletteInputBand";

export const THREAD_SEARCH_INPUT = {
  label: "Search threads",
  placeholder: "Search title, project, or message…",
};

export function threadSearchModeChip(onExit: () => void, isCompact: boolean) {
  return {
    icon: "Search" as const,
    label: "Threads",
    clearLabel: "Return to commands",
    onClear: onExit,
    hideShortcut: isCompact,
  };
}

export function PaletteStatusMessage({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 py-4 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function ThreadSearchPalettePlaceholder() {
  return (
    <>
      <PaletteInputBand>
        <Skeleton className="h-6 w-20 shrink-0 rounded-md" />
        <input
          autoFocus
          readOnly
          aria-label={THREAD_SEARCH_INPUT.label}
          className={PALETTE_INPUT_CLASS}
          placeholder={THREAD_SEARCH_INPUT.placeholder}
        />
      </PaletteInputBand>
      <div role="status" className="rounded-b-[inherit] bg-background p-1">
        <PaletteStatusMessage>Loading threads</PaletteStatusMessage>
      </div>
    </>
  );
}
