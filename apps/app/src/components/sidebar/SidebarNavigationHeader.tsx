import { useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { flushSync } from "react-dom";
import type { ExperimentalSidebarHeaderProps } from "@get-bb/plugin-sdk";
import { PluginReplacementSlot } from "@/components/plugin/PluginReplacementSlot";
import { appToast } from "@/components/ui/app-toast";
import { useSidebar } from "@/components/ui/sidebar";
import type { ExperimentalSidebarNavigationSlot } from "@/lib/plugin-slots";
import { NavRailNewThreadButton } from "./AppNavRail";
import {
  builtInNavigationForPlacement,
  RAIL_NAVIGATION_PROVIDER,
  type BuiltInNavigationProvider,
  type ResolvedSidebarNavigation,
} from "./sidebarNavigationProvider";

const SIDEBAR_HEADER_SLOT_KIND = "sidebarHeader";
const DEFAULT_CONTROL_SIZE = 28;

function readControlSize(element: HTMLElement): number {
  const value = Number.parseFloat(
    getComputedStyle(element).getPropertyValue("--bb-sidebar-control-size"),
  );
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_CONTROL_SIZE;
}

export function SidebarNavigationHeader({
  resolved,
}: {
  resolved: ResolvedSidebarNavigation;
}) {
  switch (resolved.kind) {
    case "built-in":
      return <BuiltInNavigationHeader provider={resolved.provider} />;
    case "loading":
      return (
        <BuiltInNavigationHeader
          provider={builtInNavigationForPlacement(resolved.placement)}
        />
      );
    case "plugin": {
      const header = resolved.slot.headerComponent;
      if (header === undefined) return null;
      return <PluginNavigationHeader slot={resolved.slot} header={header} />;
    }
  }
}

function BuiltInNavigationHeader({
  provider,
}: {
  provider: BuiltInNavigationProvider;
}) {
  if (provider.key !== RAIL_NAVIGATION_PROVIDER) return null;
  return (
    <div
      data-testid="nav-rail-header"
      data-sidebar-header-slot=""
      className="flex h-full min-w-0 flex-1 items-center"
    >
      <NavRailNewThreadButton />
    </div>
  );
}

function PluginNavigationHeader({
  slot,
  header: Header,
}: {
  slot: ExperimentalSidebarNavigationSlot;
  header: ComponentType<ExperimentalSidebarHeaderProps>;
}) {
  const { isCompactViewport } = useSidebar();
  const slotRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({
    width: 0,
    controlSize: DEFAULT_CONTROL_SIZE,
  });

  useLayoutEffect(() => {
    const element = slotRef.current;
    if (element === null) return;
    const measure = (width: number) => {
      if (element.hidden) return;
      const controlSize = readControlSize(element);
      setSize((current) =>
        current.width === width && current.controlSize === controlSize
          ? current
          : { width, controlSize },
      );
    };
    measure(Math.floor(element.clientWidth - paddingOf(element)));
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) flushSync(() => measure(Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [isCompactViewport]);

  return (
    <div
      ref={slotRef}
      data-testid="sidebar-header-slot"
      data-sidebar-header-slot=""
      className="flex h-full min-w-0 flex-1 items-center overflow-hidden"
    >
      <PluginReplacementSlot
        replacement={{ kind: "plugin", registration: slot }}
        original={
          <BuiltInNavigationHeader
            provider={builtInNavigationForPlacement(slot.placement)}
          />
        }
        slotKind={SIDEBAR_HEADER_SLOT_KIND}
        onCrash={(pluginId) => {
          appToast.error("Sidebar header plugin crashed", {
            description: `${slot.title} (${pluginId}) stopped working, so bb drew its own sidebar header instead.`,
          });
        }}
      >
        {() => (
          <Header
            width={size.width}
            controlSize={size.controlSize}
            isCompactViewport={isCompactViewport}
          />
        )}
      </PluginReplacementSlot>
    </div>
  );
}

function paddingOf(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return (
    (Number.parseFloat(style.paddingLeft) || 0) +
    (Number.parseFloat(style.paddingRight) || 0)
  );
}
