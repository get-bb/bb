import { useId, type ReactNode } from "react";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { ListLoadingPlaceholder } from "@/components/ui/ListLoadingPlaceholder";
import { cn } from "@bb/shared-ui/lib/utils";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { PaletteModeChip } from "./PaletteModeChip";
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

export function ThreadSearchPalettePlaceholder({
  query,
  onQueryChange,
  onExit,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  onExit: () => void;
}) {
  const listId = useId();
  const isCompact = useIsCompactViewport();
  return (
    <TooltipProvider>
      <PaletteInputBand>
        <PaletteModeChip {...threadSearchModeChip(onExit, isCompact)} />
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-label={THREAD_SEARCH_INPUT.label}
          autoComplete="off"
          spellCheck={false}
          className={cn(PALETTE_INPUT_CLASS, isCompact && "text-base")}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (
              event.key === "Escape" ||
              (event.key === "Backspace" && query.length === 0)
            ) {
              event.preventDefault();
              event.stopPropagation();
              onExit();
            }
          }}
          placeholder={THREAD_SEARCH_INPUT.placeholder}
          value={query}
        />
        <span aria-hidden className="w-8 shrink-0" />
      </PaletteInputBand>
      <div
        className="min-h-0 overflow-hidden rounded-b-[inherit] bg-background p-1"
        id={listId}
        role="listbox"
        aria-label="Threads"
      >
        <ListLoadingPlaceholder label="Loading threads" />
      </div>
    </TooltipProvider>
  );
}
