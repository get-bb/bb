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
import { AppNavRail } from "./AppNavRail";
import { SidebarNavigationCustomizePopoverContent } from "./SidebarNavigationCustomize";
import { SidebarNavigationList } from "./SidebarNavigationList";
import {
  builtInNavigationForPlacement,
  RAIL_NAVIGATION_PROVIDER,
  type BuiltInNavigationProvider,
  type ResolvedSidebarNavigation,
} from "./sidebarNavigationProvider";

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

function BuiltInNavigation({
  provider,
  isCompactViewport,
}: {
  provider: BuiltInNavigationProvider;
  isCompactViewport: boolean;
}) {
  const Component =
    provider.key === RAIL_NAVIGATION_PROVIDER
      ? AppNavRail
      : SidebarNavigationList;
  return (
    <Component
      isCompactViewport={isCompactViewport}
      placement={provider.placement}
      experimental_Original={NoOriginal}
    />
  );
}

function NoOriginal() {
  return null;
}

export function SidebarNavigationProviderMount({
  resolved,
}: {
  resolved: ResolvedSidebarNavigation;
}) {
  const { isCompactViewport } = useSidebar();
  if (resolved.kind === "loading") return null;
  if (resolved.kind === "built-in") {
    return (
      <BuiltInNavigation
        provider={resolved.provider}
        isCompactViewport={isCompactViewport}
      />
    );
  }
  const slot = resolved.slot;
  return (
    <PluginReplacementSlot
      replacement={{ kind: "plugin", registration: slot }}
      original={
        <BuiltInNavigation
          provider={builtInNavigationForPlacement(slot.placement)}
          isCompactViewport={isCompactViewport}
        />
      }
      slotKind={SIDEBAR_NAVIGATION_SLOT_KIND}
      onCrash={(pluginId) => {
        appToast.error("Sidebar navigation plugin crashed", {
          description: `${slot.title} (${pluginId}) stopped working, so bb drew its own navigation instead.`,
        });
      }}
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
        focusReturnRef={customize.focusReturnRef}
        onClose={() => customize.setCustomizing(false)}
      />
    </Popover>
  );
}
