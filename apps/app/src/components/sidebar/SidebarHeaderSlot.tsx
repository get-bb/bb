import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cn } from "@bb/shared-ui/lib/utils";
import { PluginReplacementSlot } from "@/components/plugin/PluginReplacementSlot";
import { appToast } from "@/components/ui/app-toast";
import { useSidebar } from "@/components/ui/sidebar";
import { useSidebarHeaderReplacement } from "./sidebarHeaderProvider";

const SIDEBAR_HEADER_SLOT_KIND = "sidebarHeader";
const DEFAULT_CONTROL_SIZE = 28;

function readControlSize(element: HTMLElement): number {
  const value = Number.parseFloat(
    getComputedStyle(element).getPropertyValue("--bb-sidebar-control-size"),
  );
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_CONTROL_SIZE;
}

export function SidebarHeaderSlot({
  hidden,
  startInsetClassName,
}: {
  hidden: boolean;
  startInsetClassName: string;
}) {
  const replacement = useSidebarHeaderReplacement();
  const { isCompactViewport } = useSidebar();
  const slotRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({
    width: 0,
    controlSize: DEFAULT_CONTROL_SIZE,
  });
  const isActive = replacement.kind === "plugin";

  useLayoutEffect(() => {
    const element = slotRef.current;
    if (!isActive || element === null) return;
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
  }, [isActive, isCompactViewport]);

  if (replacement.kind === "owner") return null;
  const title = replacement.registration.title;
  return (
    <div
      ref={slotRef}
      data-testid="sidebar-header-slot"
      data-sidebar-header-slot=""
      hidden={hidden || undefined}
      className={cn(
        "flex h-full min-w-0 flex-1 items-center overflow-hidden",
        startInsetClassName,
      )}
    >
      <PluginReplacementSlot
        replacement={replacement}
        original={null}
        slotKind={SIDEBAR_HEADER_SLOT_KIND}
        onCrash={(pluginId) => {
          appToast.error("Sidebar header plugin crashed", {
            description: `${title} (${pluginId}) stopped working, so bb removed it from the sidebar header.`,
          });
        }}
      >
        {(slot) => (
          <slot.component
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
