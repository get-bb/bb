import type { KeyboardEventHandler, ReactNode, Ref } from "react";
import { useComposedRefs } from "@radix-ui/react-compose-refs";
import { Icon } from "@bb/shared-ui/icon";
import { useScrollOverflowState } from "@/components/thread/timeline/useScrollOverflowState";
import { TabPill } from "@/components/ui/tab-pill";

interface PaletteModeChipProps {
  clearLabel: string;
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  onClear: () => void;
}

interface PaletteShellProps {
  activeDescendantId?: string;
  accessory?: ReactNode;
  children: ReactNode;
  footerKeys: readonly { keys: readonly string[]; label: string }[];
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
  accessory,
  children,
  footerKeys,
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
    <>
      <div
        className="border-b border-border bg-background px-3 py-2"
        data-palette-input-band
      >
        <div
          className="flex h-10 items-center gap-2 px-3"
          data-palette-input-frame
        >
          {modeChip === undefined ? null : (
            <PaletteModeChip {...modeChip} />
          )}
          <input
            ref={inputRef}
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={activeDescendantId}
            aria-label={inputLabel}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle-foreground placeholder:font-light placeholder:opacity-70"
            placeholder={placeholder}
            value={value}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={onInputKeyDown}
          />
          {accessory}
        </div>
      </div>
      <div
        className="relative min-h-0 overflow-hidden bg-background"
        data-palette-results-clip
      >
        <div
          ref={composedListRef}
          id={listId}
          role="listbox"
          aria-label={listLabel}
          className="max-h-[min(24rem,50dvh)] overflow-y-auto p-2"
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
      <div
        className="relative z-10 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-surface-recessed-soft-solid px-4 py-2 text-xs text-subtle-foreground"
        data-palette-footer
      >
        {footerKeys.map((hint) => (
          <span
            key={`${hint.keys.join(":")}:${hint.label}`}
            className="inline-flex items-center gap-1.5"
          >
            <span className="inline-flex items-center gap-1">
              {hint.keys.map((keys, index) => (
                <span key={keys} className="inline-flex items-center gap-1">
                  {index === 0 ? null : (
                    <span
                      aria-hidden
                      className="text-muted-foreground/60"
                    >
                      /
                    </span>
                  )}
                  <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-border/70 bg-background/70 px-1.5 py-0.5 font-mono text-xs leading-none text-muted-foreground shadow-xs">
                    {keys}
                  </kbd>
                </span>
              ))}
            </span>
            <span className="opacity-70" data-palette-footer-label>
              {hint.label}
            </span>
          </span>
        ))}
      </div>
    </>
  );
}

function PaletteModeChip({
  clearLabel,
  icon,
  label,
  onClear,
}: PaletteModeChipProps) {
  return (
    <span data-palette-mode-chip>
      <TabPill
        ariaLabel={`${label} search`}
        label={label}
        title={label}
        isActive
        onSelect={() => undefined}
        leadingVisual={<Icon name={icon} aria-hidden />}
        closeAction={{ onClose: onClear, closeLabel: clearLabel }}
      />
    </span>
  );
}
