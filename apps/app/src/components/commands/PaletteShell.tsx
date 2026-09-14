import {
  useId,
  type KeyboardEventHandler,
  type ReactNode,
  type Ref,
} from "react";
import { useComposedRefs } from "@radix-ui/react-compose-refs";
import { Icon } from "@bb/shared-ui/icon";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { useScrollOverflowState } from "@/components/thread/timeline/useScrollOverflowState";
import { TabPill } from "@/components/ui/tab-pill";

export const PALETTE_FOOTER_LABEL_CLASS = "text-subtle-foreground opacity-70";

interface PaletteModeChipProps {
  clearLabel: string;
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  onClear: () => void;
}

interface PaletteShellProps {
  activeDescendantId?: string;
  children: ReactNode;
  inputDescription: string;
  inputLabel: string;
  inputRef?: Ref<HTMLInputElement>;
  listId: string;
  listLabel: string;
  listRef?: Ref<HTMLDivElement>;
  modeChip?: PaletteModeChipProps;
  onInputChange: (value: string) => void;
  onInputKeyDown: KeyboardEventHandler<HTMLInputElement>;
  placeholder: string;
  value: string;
}

export function PaletteShell({
  activeDescendantId,
  children,
  inputDescription,
  inputLabel,
  inputRef,
  listId,
  listLabel,
  listRef,
  modeChip,
  onInputChange,
  onInputKeyDown,
  placeholder,
  value,
}: PaletteShellProps) {
  const inputDescriptionId = useId();
  const overflow = useScrollOverflowState<HTMLDivElement>({
    measureOverflow: true,
  });
  const composedListRef = useComposedRefs(listRef, overflow.scrollRef);
  const resultsMask =
    overflow.aboveOverflow && overflow.belowOverflow
      ? "linear-gradient(to bottom, transparent 0, black 1.5rem, black calc(100% - 1.5rem), transparent 100%)"
      : overflow.aboveOverflow
        ? "linear-gradient(to bottom, transparent 0, black 1.5rem, black 100%)"
        : overflow.belowOverflow
          ? "linear-gradient(to bottom, black 0, black calc(100% - 1.5rem), transparent 100%)"
          : undefined;

  return (
    <TooltipProvider>
      <div
        className="rounded-t-[inherit] border-b border-border bg-background px-3 py-1"
        data-palette-input-band
      >
        <div className="flex h-10 items-center gap-2" data-palette-input-frame>
          {modeChip === undefined ? null : <PaletteModeChip {...modeChip} />}
          <input
            ref={inputRef}
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={activeDescendantId}
            aria-describedby={inputDescriptionId}
            aria-label={inputLabel}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle-foreground placeholder:font-light placeholder:opacity-70"
            placeholder={placeholder}
            value={value}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={onInputKeyDown}
          />
          <span id={inputDescriptionId} className="sr-only">
            {inputDescription}
          </span>
        </div>
      </div>
      <div
        className="relative min-h-0 overflow-hidden rounded-b-[inherit] bg-background"
        data-palette-results-clip
      >
        <div
          ref={composedListRef}
          id={listId}
          role="listbox"
          aria-label={listLabel}
          className="max-h-[min(24rem,50dvh)] overflow-y-auto p-1"
          style={{
            WebkitMaskImage: resultsMask,
            maskImage: resultsMask,
          }}
          data-palette-results-viewport
        >
          <div
            ref={overflow.topSentinelRef}
            aria-hidden
            className="-mb-px h-px w-full"
            data-palette-scroll-sentinel="top"
          />
          {children}
          <div
            ref={overflow.bottomSentinelRef}
            aria-hidden
            className="h-px w-full"
            data-palette-scroll-sentinel="bottom"
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

function PaletteModeChip({
  clearLabel,
  icon,
  label,
  onClear,
}: PaletteModeChipProps) {
  return (
    <span
      data-palette-mode-chip
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClear();
      }}
    >
      <TabPill
        ariaLabel={`${label} search`}
        label={label}
        title={label}
        isActive
        onSelect={() => undefined}
        leadingVisual={<Icon name={icon} aria-hidden />}
        closeAction={{
          onClose: onClear,
          closeLabel: clearLabel,
          tooltip: `${clearLabel} (Esc)`,
        }}
      />
    </span>
  );
}
