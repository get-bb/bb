import type { KeyboardEventHandler, ReactNode, Ref } from "react";
import { Icon } from "@bb/shared-ui/icon";

interface PaletteShellProps {
  activeDescendantId?: string;
  accessory?: ReactNode;
  children: ReactNode;
  footerKeys?: readonly { keys: string; label: string }[];
  inputLabel: string;
  inputRef?: Ref<HTMLInputElement>;
  listId: string;
  listLabel: string;
  listRef?: Ref<HTMLDivElement>;
  modeChip?: { icon: Parameters<typeof Icon>[0]["name"]; label: string };
  onInputChange: (value: string) => void;
  onInputKeyDown: KeyboardEventHandler<HTMLInputElement>;
  placeholder: string;
  value: string;
}

export function PaletteShell({
  activeDescendantId,
  accessory,
  children,
  footerKeys = [],
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
  return (
    <>
      <div className="flex items-center gap-2 border-b px-3">
        {modeChip === undefined ? null : (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
            data-palette-mode-chip
          >
            <Icon name={modeChip.icon} className="size-3" aria-hidden />
            <span>{modeChip.label}</span>
          </span>
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
          className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={onInputKeyDown}
        />
        {accessory}
      </div>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={listLabel}
        className="max-h-[min(24rem,50dvh)] overflow-y-auto p-1"
      >
        {children}
      </div>
      {footerKeys.length === 0 ? null : (
        <div className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
          {footerKeys.map((hint) => (
            <span
              key={`${hint.keys}:${hint.label}`}
              className="inline-flex items-center gap-1"
            >
              <kbd className="font-sans">{hint.keys}</kbd>
              <span>{hint.label}</span>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
