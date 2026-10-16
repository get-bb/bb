import { ShortcutPill } from "@bb/shared-ui/shortcut-pill";
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

  return <ShortcutPill shortcut={shortcut} className={className} />;
}
