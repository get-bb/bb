import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { SettingsWithControl } from "@/components/ui/settings-section";
import { normalizeFontFamily } from "@/lib/font-preference";

export const UI_FONT_FAMILY_EXAMPLE = '"Geist Variable", sans-serif';
export const BUFFER_FONT_FAMILY_EXAMPLE = '"iA Writer Mono", monospace';

export const UI_FONT_FAMILY_SUGGESTIONS = [
  UI_FONT_FAMILY_EXAMPLE,
  '"Inter Variable", Inter, sans-serif',
  "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  '"IBM Plex Sans", sans-serif',
] as const;

export const BUFFER_FONT_FAMILY_SUGGESTIONS = [
  BUFFER_FONT_FAMILY_EXAMPLE,
  '"Fira Code", monospace',
  '"JetBrains Mono", monospace',
  '"Berkeley Mono", monospace',
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
] as const;

export interface FontFamilySettingsControlProps {
  description: string;
  disabled: boolean;
  label: string;
  onValueCommit: (value: string) => void;
  placeholder: string;
  suggestions: readonly string[];
  value: string;
}

export function FontFamilySettingsControl({
  description,
  disabled,
  label,
  onValueCommit,
  placeholder,
  suggestions,
  value,
}: FontFamilySettingsControlProps) {
  const [edit, setEdit] = useState({ baseValue: value, draft: value });
  if (edit.baseValue !== value) {
    setEdit({ baseValue: value, draft: value });
  }
  const draft = edit.baseValue === value ? edit.draft : value;
  const listId = `${label.toLowerCase().replace(/\s+/gu, "-")}-options`;
  const exampleId = `${listId}-example`;
  const normalizedDraft = normalizeFontFamily(draft);
  const normalizedValue = normalizeFontFamily(value);
  const hasChanges = normalizedDraft !== normalizedValue;

  const commit = () => {
    if (!disabled && hasChanges) {
      onValueCommit(normalizedDraft);
    }
  };

  return (
    <SettingsWithControl label={label} description={description}>
      <div className="w-full sm:w-auto">
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Input
            aria-describedby={exampleId}
            aria-label={`${label} family`}
            className="h-7 min-w-0 flex-1 text-xs sm:w-64 sm:flex-none"
            disabled={disabled}
            list={listId}
            maxLength={256}
            onChange={(event) =>
              setEdit({ baseValue: value, draft: event.target.value })
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commit();
              }
            }}
            placeholder={placeholder}
            spellCheck={false}
            style={{ fontFamily: normalizedDraft || undefined }}
            value={draft}
          />
          <datalist id={listId}>
            {suggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={disabled || !hasChanges}
            onClick={commit}
          >
            Apply
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={disabled || normalizedValue.length === 0}
            onClick={() => onValueCommit("")}
          >
            Reset
          </Button>
        </div>
        <p
          className="mt-1 text-[11px] text-subtle-foreground/75"
          id={exampleId}
        >
          Example: {placeholder}
        </p>
      </div>
    </SettingsWithControl>
  );
}
