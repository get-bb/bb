import { useLayoutEffect, useRef } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { PluginReplacementSlot } from "@/components/plugin/PluginReplacementSlot";
import { appToast } from "@/components/ui/app-toast";
import { useSidebar } from "@/components/ui/sidebar";
import {
  BuiltInSidebarNavigation,
  type BuiltInSidebarNavigationProps,
} from "./BuiltInSidebarNavigation";
import { SidebarNavigationCustomize } from "./SidebarNavigationCustomize";
import { useSidebarNavigationReplacement } from "./sidebarNavigationProvider";

const SIDEBAR_NAVIGATION_SLOT_KIND = "sidebarNavigation";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function resolveCustomizeFocusReturnTarget(
  container: HTMLElement | null,
): HTMLElement | null {
  if (container === null) return null;
  const active = document.activeElement;
  if (active instanceof HTMLElement && container.contains(active)) {
    return active;
  }
  const openTrigger = container.querySelector<HTMLElement>(
    '[aria-expanded="true"], [data-state="open"]',
  );
  if (openTrigger === null) return null;
  return openTrigger.matches(FOCUSABLE_SELECTOR)
    ? openTrigger
    : openTrigger.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
}

export type SidebarNavigationRegionProps = BuiltInSidebarNavigationProps & {
  isCustomizing: boolean;
  onCustomizingChange: (isCustomizing: boolean) => void;
  focusReturnTargetRef: { current: HTMLElement | null };
};

export function SidebarNavigationRegion({
  isCustomizing,
  onCustomizingChange,
  focusReturnTargetRef,
  ...builtInProps
}: SidebarNavigationRegionProps) {
  const replacement = useSidebarNavigationReplacement();
  const { isCompactViewport } = useSidebar();
  const restoreFocusRef = useRef(false);

  useLayoutEffect(() => {
    if (isCustomizing || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    const target = focusReturnTargetRef.current;
    focusReturnTargetRef.current = null;
    if (target?.isConnected) target.focus();
  }, [focusReturnTargetRef, isCustomizing]);

  const original = <BuiltInSidebarNavigation {...builtInProps} />;
  const title =
    replacement.kind === "plugin" ? replacement.registration.title : "Plugin";
  return (
    <nav
      aria-label="Sidebar navigation"
      data-testid="sidebar-navigation-region"
      className={cn(
        (isCustomizing || builtInProps.compactCustomizeMode) &&
          isCompactViewport &&
          "flex min-h-0 flex-1 flex-col",
      )}
    >
      {isCustomizing ? (
        <SidebarNavigationCustomize
          onClose={(restoreFocus) => {
            restoreFocusRef.current = restoreFocus;
            onCustomizingChange(false);
          }}
        />
      ) : null}
      <div
        hidden={isCustomizing || undefined}
        className={isCustomizing ? undefined : "contents"}
      >
        <PluginReplacementSlot
          replacement={replacement}
          original={original}
          slotKind={SIDEBAR_NAVIGATION_SLOT_KIND}
          onCrash={(pluginId) => {
            appToast.error("Sidebar navigation plugin crashed", {
              description: `${title} (${pluginId}) stopped working, so bb's own navigation is back.`,
            });
          }}
        >
          {(slot, Original) => (
            <slot.component
              isCompactViewport={isCompactViewport}
              experimental_Original={Original}
            />
          )}
        </PluginReplacementSlot>
      </div>
    </nav>
  );
}
