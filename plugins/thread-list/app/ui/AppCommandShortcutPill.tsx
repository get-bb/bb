import { cn } from "@/lib/utils";

interface AppCommandShortcutPillProps {
  ariaHidden?: boolean;
  shortcut: { label: string };
  className?: string;
}

const APP_COMMAND_SHORTCUT_HINT_CLASS =
  "pointer-events-none inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-sm bg-state-hover px-1.5 py-1 font-sans text-xs font-normal leading-none tabular-nums text-subtle-foreground opacity-60";

export function AppCommandShortcutPill({
  ariaHidden = true,
  shortcut,
  className,
}: AppCommandShortcutPillProps) {
  return (
    <kbd
      aria-hidden={ariaHidden}
      className={cn(APP_COMMAND_SHORTCUT_HINT_CLASS, className)}
    >
      {shortcut.label}
    </kbd>
  );
}
