import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { ExperimentalSidebarHeaderProps } from "@get-bb/plugin-sdk";
import { cn } from "@bb/shared-ui/lib/utils";
import { PluginReplacementSlot } from "@/components/plugin/PluginReplacementSlot";
import { appToast } from "@/components/ui/app-toast";
import { useSidebar } from "@/components/ui/sidebar";
import type { ExperimentalSidebarNavigationSlot } from "@/lib/plugin-slots";
import { useSidebarHeaderControlAxisClass } from "./SidebarChrome";
import type { ResolvedSidebarNavigation } from "./sidebarNavigationProvider";

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
  if (resolved.kind !== "plugin") return null;
  if (resolved.slot.headerComponent === undefined) return null;
  return (
    <PluginNavigationHeader slot={resolved.slot} fallback={resolved.fallback} />
  );
}

function HeaderSlot({
  slot,
  original,
  props,
  onCrash,
}: {
  slot: ExperimentalSidebarNavigationSlot;
  original: ReactNode;
  props: ExperimentalSidebarHeaderProps;
  onCrash?: (pluginId: string) => void;
}) {
  const Header = slot.headerComponent;
  if (Header === undefined) return original;
  return (
    <PluginReplacementSlot
      replacement={{ kind: "plugin", registration: slot }}
      original={original}
      slotKind={SIDEBAR_HEADER_SLOT_KIND}
      {...(onCrash === undefined ? {} : { onCrash })}
    >
      {() => <Header {...props} />}
    </PluginReplacementSlot>
  );
}

function PluginNavigationHeader({
  slot,
  fallback,
}: {
  slot: ExperimentalSidebarNavigationSlot;
  fallback: ExperimentalSidebarNavigationSlot | null;
}) {
  const { isCompactViewport } = useSidebar();
  const axisClass = useSidebarHeaderControlAxisClass();
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

  const props = {
    width: size.width,
    controlSize: size.controlSize,
    isCompactViewport,
  };
  const fallbackHeader =
    fallback?.headerComponent === undefined ? null : fallback.title;
  return (
    <div
      ref={slotRef}
      data-testid="sidebar-header-slot"
      data-sidebar-header-slot=""
      className={cn(
        "flex h-full min-w-0 flex-1 items-center overflow-hidden",
        axisClass,
      )}
    >
      <HeaderSlot
        slot={slot}
        props={props}
        original={
          fallback === null ? null : (
            <HeaderSlot slot={fallback} props={props} original={null} />
          )
        }
        onCrash={(pluginId) => {
          appToast.error("Sidebar header plugin crashed", {
            description:
              fallbackHeader === null
                ? `${slot.title} (${pluginId}) stopped working.`
                : `${slot.title} (${pluginId}) stopped working, so bb drew the ${fallbackHeader} header instead.`,
          });
        }}
      />
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
