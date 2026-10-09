import { useEffect } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  useAppCommandRunner,
  useAppCommandShortcut,
} from "@/components/commands/AppCommandProvider";
import { AppCommandShortcutHint } from "@/components/commands/AppCommandShortcutHint";
import { preloadThreadSecondaryPanel } from "@/components/secondary-panel/lazySecondaryPanelComponents";
import { RIGHT_PANEL_TOGGLE_ICON_NAME } from "@/components/secondary-panel/panelToggleControlState";
import { useIsSidebarFramed } from "@/components/ui/sidebar.js";

interface WindowRightPanelRegistration {
  token: symbol;
  isOpen: boolean;
}

const windowRightPanelRegistrationsAtom = atom<
  readonly WindowRightPanelRegistration[]
>([]);

export function useWindowTitleBarHostsRightPanelToggle(): boolean {
  return useIsSidebarFramed();
}

export function useWindowRightPanel({
  isOpen,
  enabled,
}: {
  isOpen: boolean;
  enabled: boolean;
}): void {
  const setRegistrations = useSetAtom(windowRightPanelRegistrationsAtom);
  useEffect(() => {
    if (!enabled) return;
    const token = Symbol("window-right-panel");
    setRegistrations((current) => [...current, { token, isOpen }]);
    return () => {
      setRegistrations((current) =>
        current.filter((registration) => registration.token !== token),
      );
    };
  }, [enabled, isOpen, setRegistrations]);
}

export function WindowRightPanelToggle({ className }: { className?: string }) {
  const panel = useAtomValue(windowRightPanelRegistrationsAtom).at(-1);
  const shortcut = useAppCommandShortcut("panel.toggle");
  const { dispatch } = useAppCommandRunner();
  if (panel === undefined) return null;
  const label = panel.isOpen ? "Hide right panel" : "Show right panel";

  return (
    <div className={cn("relative flex items-center", className)}>
      <AppCommandShortcutHint
        shortcut={shortcut}
        className="absolute right-full mr-1"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-testid="window-right-panel-toggle"
        className={cn(COARSE_POINTER_HEADER_ICON_BUTTON_CLASS, "select-none")}
        aria-label={shortcut ? `${label} (${shortcut.label})` : label}
        aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
        aria-expanded={panel.isOpen}
        onPointerEnter={preloadThreadSecondaryPanel}
        onFocus={preloadThreadSecondaryPanel}
        onPointerDown={preloadThreadSecondaryPanel}
        onClick={() => dispatch("panel.toggle", null)}
      >
        <Icon name={RIGHT_PANEL_TOGGLE_ICON_NAME} />
      </Button>
    </div>
  );
}
