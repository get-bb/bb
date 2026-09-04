import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useNavigate } from "react-router-dom";
import type { ExperimentalSidebarFooterCommandKind } from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import { cn } from "@bb/shared-ui/lib/utils";
import { COARSE_POINTER_CHILD_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar.js";
import { PluginIcon, pluginIconName } from "@/components/plugin/PluginIcon";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import {
  usePluginSlots,
  type ExperimentalSidebarFooterItemSlot,
  type PluginSidebarFooterActionSlot,
} from "@/lib/plugin-slots";
import { getPluginConfigurationRoutePath } from "@/lib/route-paths";

const SIDEBAR_FOOTER_ACTION_CLASS = cn(
  COARSE_POINTER_CHILD_ICON_BUTTON_CLASS,
  "relative text-muted-foreground hover:text-sidebar-foreground [&>svg]:opacity-80",
);

const BADGE_TONE_CLASS = {
  info: "bg-primary",
  warning: "bg-warning",
  critical: "bg-destructive",
} as const;

function footerItemKey(item: ExperimentalSidebarFooterItemSlot): string {
  return `${item.pluginId}/${item.id}/${item.generation}`;
}

function footerDisclosureId(item: ExperimentalSidebarFooterItemSlot): string {
  return `plugin-sidebar-footer-disclosure-${item.pluginId}-${item.id}-${item.generation}`;
}

function footerTriggerId(item: ExperimentalSidebarFooterItemSlot): string {
  return `plugin-sidebar-footer-trigger-${item.pluginId}-${item.id}-${item.generation}`;
}

export function usePluginSidebarFooterDisclosure() {
  const { experimentalSidebarFooterItems } = usePluginSlots();
  const disclosures = useMemo(
    () =>
      experimentalSidebarFooterItems.filter(
        (item) => item.kind === "disclosure",
      ),
    [experimentalSidebarFooterItems],
  );
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [suppressedTooltipKey, setSuppressedTooltipKey] = useState<
    string | null
  >(null);
  const lastProgrammaticCommand = useRef(0);
  const activeItem = useMemo(
    () => disclosures.find((item) => footerItemKey(item) === activeKey) ?? null,
    [activeKey, disclosures],
  );
  const suppressedTooltipItem = useMemo(
    () =>
      disclosures.find(
        (item) => footerItemKey(item) === suppressedTooltipKey,
      ) ?? null,
    [disclosures, suppressedTooltipKey],
  );

  const handleCommand = useCallback(
    (
      itemKey: string,
      command: ExperimentalSidebarFooterCommandKind,
      sequence?: number,
    ) => {
      if (sequence !== undefined) {
        if (sequence <= lastProgrammaticCommand.current) return;
        lastProgrammaticCommand.current = sequence;
      }
      const isClosing =
        (command === "close" && activeKey === itemKey) ||
        (command === "toggle" && activeKey === itemKey);
      setSuppressedTooltipKey(isClosing ? itemKey : null);
      setActiveKey((current) => {
        if (command === "open") return itemKey;
        if (command === "close") return current === itemKey ? null : current;
        return current === itemKey ? null : itemKey;
      });
    },
    [activeKey],
  );

  const dismiss = useCallback(() => {
    if (activeItem !== null) {
      setSuppressedTooltipKey(footerItemKey(activeItem));
    }
    setActiveKey(null);
  }, [activeItem]);

  useLayoutEffect(() => {
    if (suppressedTooltipItem === null || activeItem !== null) return;
    document
      .getElementById(footerTriggerId(suppressedTooltipItem))
      ?.focus({ preventScroll: true });
  }, [activeItem, suppressedTooltipItem]);

  const clearTooltipSuppression = useCallback((itemKey: string) => {
    setSuppressedTooltipKey((current) =>
      current === itemKey ? null : current,
    );
  }, []);

  useEffect(() => {
    if (activeItem === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeItem, dismiss]);

  return {
    activeItem,
    activeKey: activeItem === null ? null : activeKey,
    suppressedTooltipKey,
    clearTooltipSuppression,
    dismiss,
    handleCommand,
  };
}

export function PluginSidebarFooterDisclosure({
  item,
  onDismiss,
}: {
  item: ExperimentalSidebarFooterItemSlot | null;
  onDismiss: () => void;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (content === null) return;
    const measure = () =>
      setContentHeight(content.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [item]);

  if (item === null || item.kind !== "disclosure") return null;
  const Component = item.component;
  return (
    <section
      id={footerDisclosureId(item)}
      aria-label={item.label}
      data-testid={`plugin-sidebar-footer-disclosure-${item.pluginId}-${item.id}`}
      className="overflow-hidden rounded-lg border border-sidebar-border bg-sidebar-accent/50 transition-[height] duration-200 ease-out motion-reduce:transition-none group-data-[collapsible=icon]:hidden"
      style={{ height: contentHeight ?? undefined }}
    >
      <div ref={contentRef} className="max-h-80 overflow-auto">
        <PluginSlotMount
          pluginId={item.pluginId}
          slotKind="experimental_sidebarFooter"
          slotId={item.id}
        >
          <Component dismiss={onDismiss} />
        </PluginSlotMount>
      </div>
    </section>
  );
}

export function PluginSidebarFooterItems({
  activeDisclosureKey,
  suppressedTooltipKey,
  onTooltipSuppressionEnd,
  onDisclosureCommand,
  onNavigate,
}: {
  activeDisclosureKey: string | null;
  suppressedTooltipKey: string | null;
  onTooltipSuppressionEnd: (itemKey: string) => void;
  onDisclosureCommand: (
    itemKey: string,
    command: ExperimentalSidebarFooterCommandKind,
    sequence?: number,
  ) => void;
  onNavigate?: () => void;
}) {
  const { sidebarFooterActions, experimentalSidebarFooterItems } =
    usePluginSlots();
  if (
    sidebarFooterActions.length === 0 &&
    experimentalSidebarFooterItems.length === 0
  ) {
    return null;
  }
  return (
    <>
      {sidebarFooterActions.map((action) => (
        <LegacyFooterActionButton
          key={`${action.pluginId}/${action.id}/${action.generation}`}
          action={action}
          onNavigate={onNavigate}
        />
      ))}
      {experimentalSidebarFooterItems.map((item) => (
        <ExperimentalFooterItemButton
          key={footerItemKey(item)}
          item={item}
          isActive={footerItemKey(item) === activeDisclosureKey}
          isTooltipSuppressed={footerItemKey(item) === suppressedTooltipKey}
          onTooltipSuppressionEnd={onTooltipSuppressionEnd}
          onDisclosureCommand={onDisclosureCommand}
          onNavigate={onNavigate}
        />
      ))}
    </>
  );
}

function LegacyFooterActionButton({
  action,
  onNavigate,
}: {
  action: PluginSidebarFooterActionSlot;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <SidebarMenuItem className="min-w-0">
      <SidebarMenuButton
        className={SIDEBAR_FOOTER_ACTION_CLASS}
        tooltip={{ children: action.title, hidden: false, side: "top" }}
        aria-label={action.title}
        data-testid={`plugin-sidebar-footer-action-${action.pluginId}-${action.id}`}
        onClick={() => {
          onNavigate?.();
          runContainedFooterCallback(
            action.pluginId,
            `sidebarFooterAction "${action.id}"`,
            () =>
              action.run({
                openSettings: () => {
                  void navigate(
                    getPluginConfigurationRoutePath({
                      pluginId: action.pluginId,
                    }),
                  );
                },
              }),
          );
        }}
      >
        <PluginIcon pluginId={action.pluginId} icon={action.icon} />
        <span className="sr-only">{action.title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function ExperimentalFooterItemButton({
  item,
  isActive,
  isTooltipSuppressed,
  onTooltipSuppressionEnd,
  onDisclosureCommand,
  onNavigate,
}: {
  item: ExperimentalSidebarFooterItemSlot;
  isActive: boolean;
  isTooltipSuppressed: boolean;
  onTooltipSuppressionEnd: (itemKey: string) => void;
  onDisclosureCommand: (
    itemKey: string,
    command: ExperimentalSidebarFooterCommandKind,
    sequence?: number,
  ) => void;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const snapshot = useSyncExternalStore(
    item.runtime.subscribe,
    item.runtime.getSnapshot,
    item.runtime.getSnapshot,
  );
  const command = snapshot.command;
  const itemKey = footerItemKey(item);

  useEffect(() => {
    if (command === null || item.kind !== "disclosure") return;
    onDisclosureCommand(itemKey, command.kind, command.sequence);
    item.runtime.acknowledgeCommand(command.sequence);
  }, [command, item, itemKey, onDisclosureCommand]);

  const accessibleLabel =
    snapshot.badge === null
      ? item.label
      : `${item.label}: ${snapshot.badge.label}`;

  return (
    <SidebarMenuItem className="min-w-0">
      <SidebarMenuButton
        id={footerTriggerId(item)}
        type="button"
        aria-label={accessibleLabel}
        tooltip={{
          children: item.label,
          hidden: isTooltipSuppressed,
          side: "top",
        }}
        className={cn(
          SIDEBAR_FOOTER_ACTION_CLASS,
          isActive &&
            "bg-sidebar-accent text-sidebar-accent-foreground [&>svg]:opacity-100",
        )}
        data-testid={`plugin-sidebar-footer-item-${item.pluginId}-${item.id}`}
        onBlur={() => onTooltipSuppressionEnd(itemKey)}
        onPointerLeave={() => onTooltipSuppressionEnd(itemKey)}
        {...(item.kind === "disclosure"
          ? {
              "aria-expanded": isActive,
              "aria-controls": footerDisclosureId(item),
            }
          : {})}
        onClick={() => {
          if (item.kind === "disclosure") {
            onDisclosureCommand(itemKey, "toggle");
            return;
          }
          onNavigate?.();
          runContainedFooterCallback(
            item.pluginId,
            `experimental_sidebarFooter item "${item.id}"`,
            () =>
              item.onActivate({
                openPluginDetails: () => {
                  void navigate(
                    getPluginConfigurationRoutePath({
                      pluginId: item.pluginId,
                    }),
                  );
                },
              }),
          );
        }}
      >
        <Icon
          name={pluginIconName(item.icon)}
          className="size-4 shrink-0"
          aria-hidden="true"
        />
        <span className="sr-only">{accessibleLabel}</span>
        {snapshot.badge === null ? null : (
          <span
            aria-hidden="true"
            data-sidebar-footer-badge={snapshot.badge.tone}
            className={cn(
              "absolute right-1 top-1 size-1.5 rounded-full ring-2 ring-sidebar",
              BADGE_TONE_CLASS[snapshot.badge.tone],
            )}
          />
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function runContainedFooterCallback(
  pluginId: string,
  label: string,
  callback: () => void | Promise<void>,
): void {
  const warn = (error: unknown) => {
    console.warn(
      `[plugin:${pluginId}] ${label} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  };
  try {
    const result = callback();
    if (result instanceof Promise) result.catch(warn);
  } catch (error) {
    warn(error);
  }
}
