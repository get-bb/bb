import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { ExperimentalSidebarNavigationPlacement } from "@get-bb/plugin-sdk";
import { Popover, PopoverAnchor } from "@bb/shared-ui/popover";
import { PluginReplacementSlot } from "@/components/plugin/PluginReplacementSlot";
import { appToast } from "@/components/ui/app-toast";
import { useSidebar } from "@/components/ui/sidebar.js";
import type { ExperimentalSidebarNavigationSlot } from "@/lib/plugin-slots";
import { SidebarNavigationCustomizePopoverContent } from "./SidebarNavigationCustomize";
import type { ResolvedSidebarNavigation } from "./sidebarNavigationProvider";

const SIDEBAR_NAVIGATION_SLOT_KIND = "sidebarNavigation";
const OPEN_MENU_SELECTOR = '[role="menu"]';
const OPEN_MENU_WAIT_MS = 1000;
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function afterOpenMenusClose(run: () => void): () => void {
  const start = performance.now();
  let frame = 0;
  let timer = 0;
  const check = () => {
    if (
      document.querySelector(OPEN_MENU_SELECTOR) !== null &&
      performance.now() - start < OPEN_MENU_WAIT_MS
    ) {
      frame = requestAnimationFrame(check);
      return;
    }
    timer = window.setTimeout(run, 0);
  };
  check();
  return () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
}

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

export interface SidebarNavigationCustomize {
  isCustomizing: boolean;
  setCustomizing: (isCustomizing: boolean) => void;
  open: () => void;
  containerRef: RefObject<HTMLElement | null>;
  focusReturnRef: RefObject<HTMLElement | null>;
}

export function useSidebarNavigationCustomize(
  onOpen?: () => void,
): SidebarNavigationCustomize {
  const [isCustomizing, setCustomizing] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const cancelPendingRef = useRef<(() => void) | null>(null);
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });
  const open = useCallback(() => {
    focusReturnRef.current = resolveCustomizeFocusReturnTarget(
      containerRef.current,
    );
    onOpenRef.current?.();
    cancelPendingRef.current?.();
    cancelPendingRef.current = afterOpenMenusClose(() => setCustomizing(true));
  }, []);
  useEffect(() => () => cancelPendingRef.current?.(), []);
  return { isCustomizing, setCustomizing, open, containerRef, focusReturnRef };
}

function NavigationProviderSlot({
  slot,
  original,
  isCompactViewport,
  onCrash,
}: {
  slot: ExperimentalSidebarNavigationSlot;
  original: ReactNode;
  isCompactViewport: boolean;
  onCrash?: (pluginId: string) => void;
}) {
  return (
    <PluginReplacementSlot
      replacement={{ kind: "plugin", registration: slot }}
      original={original}
      slotKind={SIDEBAR_NAVIGATION_SLOT_KIND}
      {...(onCrash === undefined ? {} : { onCrash })}
    >
      {(registration, Original) => (
        <registration.component
          isCompactViewport={isCompactViewport}
          placement={registration.placement}
          experimental_Original={Original}
        />
      )}
    </PluginReplacementSlot>
  );
}

export function SidebarNavigationProviderMount({
  resolved,
}: {
  resolved: ResolvedSidebarNavigation;
}) {
  const { isCompactViewport } = useSidebar();
  if (resolved.kind === "loading") return null;
  if (resolved.kind === "missing") {
    return (
      <div
        role="status"
        data-sidebar-navigation-placeholder="missing"
        className="px-4 py-2 text-sm text-muted-foreground"
      >
        No navigation plugin is enabled.
      </div>
    );
  }
  const { slot, fallback } = resolved;
  return (
    <NavigationProviderSlot
      slot={slot}
      isCompactViewport={isCompactViewport}
      original={
        fallback === null ? null : (
          <NavigationProviderSlot
            slot={fallback}
            original={null}
            isCompactViewport={isCompactViewport}
          />
        )
      }
      onCrash={(pluginId) => {
        appToast.error("Sidebar navigation plugin crashed", {
          description:
            fallback === null
              ? `${slot.title} (${pluginId}) stopped working.`
              : `${slot.title} (${pluginId}) stopped working, so bb drew ${fallback.title} instead.`,
        });
      }}
    />
  );
}

export function SidebarNavigationRegion({
  placement,
  customize,
  className,
  children,
}: {
  placement: ExperimentalSidebarNavigationPlacement;
  customize: SidebarNavigationCustomize;
  className?: string;
  children: ReactNode;
}) {
  const isRail = placement === "rail";
  return (
    <Popover
      open={customize.isCustomizing}
      onOpenChange={customize.setCustomizing}
    >
      <PopoverAnchor asChild>
        <nav
          ref={customize.containerRef}
          aria-label="Sidebar navigation"
          data-testid={
            isRail ? "sidebar-navigation-rail" : "sidebar-navigation-region"
          }
          data-sidebar-navigation-placement={placement}
          className={className}
        >
          {children}
        </nav>
      </PopoverAnchor>
      <SidebarNavigationCustomizePopoverContent
        testId={isRail ? "nav-rail-customize" : "sidebar-navigation-customize"}
        placement={placement}
        focusReturnRef={customize.focusReturnRef}
        onClose={() => customize.setCustomizing(false)}
      />
    </Popover>
  );
}
