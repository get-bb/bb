import { cn } from "../../lib/utils";

interface ShortcutPillProps {
  ariaHidden?: boolean;
  shortcut: { label: string };
  className?: string;
}

const SHORTCUT_PILL_CLASS =
  "pointer-events-none inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-sm bg-state-hover px-1.5 py-1 font-sans text-xs font-normal leading-none tabular-nums text-subtle-foreground opacity-60";

export function ShortcutPill({
  ariaHidden = true,
  shortcut,
  className,
}: ShortcutPillProps) {
  return (
    <kbd
      aria-hidden={ariaHidden}
      className={cn(SHORTCUT_PILL_CLASS, className)}
    >
      {shortcut.label}
    </kbd>
  );
}
