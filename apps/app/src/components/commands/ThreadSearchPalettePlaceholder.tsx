import { useId, type ReactNode } from "react";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { ListLoadingPlaceholder } from "@/components/ui/ListLoadingPlaceholder";
import { PaletteShell } from "./PaletteShell";

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
    <PaletteShell
      inputDescription="Use Escape to return to commands."
      inputLabel={THREAD_SEARCH_INPUT.label}
      listId={listId}
      listLabel="Threads"
      modeChip={threadSearchModeChip(onExit, isCompact)}
      inputAccessory={<span aria-hidden className="w-8 shrink-0" />}
      onInputChange={onQueryChange}
      onInputKeyDown={(event) => {
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
    >
      <ListLoadingPlaceholder label="Loading threads" />
    </PaletteShell>
  );
}
