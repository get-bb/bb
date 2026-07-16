import { cn } from "@bb/shared-ui/lib/utils";
import type { AppShortcutPresentation } from "@/lib/app-keybindings";
import { useIsAppCommandModifierHeld } from "./AppCommandProvider";

interface AppCommandShortcutHintProps {
  shortcut: AppShortcutPresentation | null;
  className?: string;
}

export const APP_COMMAND_SHORTCUT_HINT_CLASS =
  "pointer-events-none inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-sm bg-state-hover p-1 text-xs font-normal leading-none tabular-nums text-subtle-foreground [word-spacing:-0.15em]";

export function AppCommandShortcutHint({
  shortcut,
  className,
}: AppCommandShortcutHintProps) {
  const isPrimaryModifierHeld = useIsAppCommandModifierHeld();
  if (!isPrimaryModifierHeld || !shortcut) return null;

  return (
    <kbd
      aria-hidden="true"
      className={cn(
        APP_COMMAND_SHORTCUT_HINT_CLASS,
        className,
      )}
    >
      {shortcut.label}
    </kbd>
  );
}
