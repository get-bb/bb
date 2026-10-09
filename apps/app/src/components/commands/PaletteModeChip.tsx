import { Icon } from "@bb/shared-ui/icon";
import { TabPill } from "@/components/ui/tab-pill";

export interface PaletteModeChipProps {
  clearLabel: string;
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  onClear: () => void;
  hideShortcut?: boolean;
}

export function PaletteModeChip({
  clearLabel,
  icon,
  label,
  onClear,
  hideShortcut,
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
          tooltip: hideShortcut ? clearLabel : `${clearLabel} (Esc)`,
        }}
      />
    </span>
  );
}
