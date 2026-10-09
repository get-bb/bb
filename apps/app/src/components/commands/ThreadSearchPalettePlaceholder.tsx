import { useId, type ReactNode } from "react";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
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
  onExit,
}: {
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
      onInputChange={() => undefined}
      onInputKeyDown={() => undefined}
      placeholder={THREAD_SEARCH_INPUT.placeholder}
      value=""
    >
      <div role="status">
        <PaletteStatusMessage>Loading threads</PaletteStatusMessage>
      </div>
    </PaletteShell>
  );
}
