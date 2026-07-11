import { cn } from "@bb/shared-ui/lib/utils";
import type { AppShortcutPresentation } from "@/lib/app-keybindings";
import { useIsAppCommandModifierHeld } from "./AppCommandProvider";

interface AppCommandShortcutHintProps {
  shortcut: AppShortcutPresentation | null;
  className?: string;
}

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
        "pointer-events-none inline-flex h-5 min-w-7 shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-surface-raised px-1 text-xs font-medium tabular-nums text-muted-foreground [word-spacing:-0.15em] shadow-[inset_0_0_0_1px_var(--border)]",
        className,
      )}
    >
      {shortcut.label}
    </kbd>
  );
}
