import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ExperimentalSidebarFooterCommandKind } from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import { cn } from "@bb/shared-ui/lib/utils";
import { COARSE_POINTER_CHILD_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar.js";
import { PluginIcon, pluginIconName } from "@/components/plugin/PluginIcon";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import {
  usePluginSlots,
  type PluginSidebarFooterItemSlot,
} from "@/lib/plugin-slots";
import {
  getSettingsRoutePath,
  getPluginConfigurationRoutePath,
} from "@/lib/route-paths";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import {
  useSidebarFooterPreferences,
  SIDEBAR_FOOTER_MORE_ID,
  type FooterItem,
  type BuiltinFooterId,
} from "@/components/sidebar/sidebarFooterPreferences";

const SIDEBAR_FOOTER_ACTION_CLASS = cn(
  COARSE_POINTER_CHILD_ICON_BUTTON_CLASS,
  "text-muted-foreground hover:text-sidebar-foreground [&>[data-icon-root]]:opacity-80",
);

function footerItemKey(item: PluginSidebarFooterItemSlot): string {
  return `${item.pluginId}/${item.id}/${item.generation}`;
}

function footerDisclosureId(item: PluginSidebarFooterItemSlot): string {
  return `plugin-sidebar-footer-disclosure-${item.pluginId}-${item.id}-${item.generation}`;
}

function footerTriggerId(item: PluginSidebarFooterItemSlot): string {
  return `plugin-sidebar-footer-trigger-${item.pluginId}-${item.id}-${item.generation}`;
}

export function usePluginSidebarFooterDisclosure() {
  const { sidebarFooterItems } = usePluginSlots();
  const disclosures = useMemo(
    () => sidebarFooterItems.filter((item) => item.kind === "disclosure"),
    [sidebarFooterItems],
  );
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [restoreFocusKey, setRestoreFocusKey] = useState<string | null>(null);
  const lastProgrammaticCommand = useRef(0);
  const activeItem = useMemo(
    () => disclosures.find((item) => footerItemKey(item) === activeKey) ?? null,
    [activeKey, disclosures],
  );
  const restoreFocusItem = useMemo(
    () =>
      disclosures.find((item) => footerItemKey(item) === restoreFocusKey) ??
      null,
    [disclosures, restoreFocusKey],
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
      setRestoreFocusKey(isClosing ? itemKey : null);
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
      setRestoreFocusKey(footerItemKey(activeItem));
    }
    setActiveKey(null);
  }, [activeItem]);

  useLayoutEffect(() => {
    if (restoreFocusItem === null || activeItem !== null) return;
    (
      document.getElementById(footerTriggerId(restoreFocusItem)) ??
      document.getElementById(SIDEBAR_FOOTER_MORE_ID)
    )?.focus({ preventScroll: true });
  }, [activeItem, restoreFocusItem]);

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
    dismiss,
    handleCommand,
  };
}

export function PluginSidebarFooterDisclosure({
  item,
  onDismiss,
}: {
  item: PluginSidebarFooterItemSlot | null;
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

export interface BuiltinFooterAction {
  id: BuiltinFooterId;
  onActivate(): void;
  href?: string;
  ariaLabel?: string;
  ariaKeyShortcuts?: string;
}

export function PluginSidebarFooterItems({
  activeDisclosureKey,
  onDisclosureCommand,
  onNavigate,
  builtInActions = [],
}: {
  activeDisclosureKey: string | null;
  onDisclosureCommand: (
    itemKey: string,
    command: ExperimentalSidebarFooterCommandKind,
    sequence?: number,
  ) => void;
  onNavigate?: () => void;
  builtInActions?: readonly BuiltinFooterAction[];
}) {
  const navigate = useNavigate();
  const preferences = useSidebarFooterPreferences();
  const previousHidden = useRef(preferences.hidden);
  const items = preferences.items.filter(
    (item) =>
      item.kind === "plugin" ||
      builtInActions.some((action) => action.id === item.id),
  );
  const hidden = items.filter((item) => preferences.hidden.includes(item.key));
  useEffect(() => {
    for (const item of items) {
      if (
        item.kind === "plugin" &&
        item.slot.kind === "disclosure" &&
        preferences.hidden.includes(item.key) &&
        !previousHidden.current.includes(item.key)
      ) {
        onDisclosureCommand(footerItemKey(item.slot), "close");
      }
    }
    previousHidden.current = preferences.hidden;
  }, [items, preferences.hidden, onDisclosureCommand]);

  function activate(item: FooterItem) {
    if (item.kind === "builtin") {
      builtInActions.find((action) => action.id === item.id)?.onActivate();
      return;
    }
    const slot = item.slot;
    if (slot.kind === "disclosure") {
      onDisclosureCommand(footerItemKey(slot), "toggle");
      return;
    }
    onNavigate?.();
    runContainedFooterCallback(
      slot.pluginId,
      slot.source === "sidebarFooterAction"
        ? `sidebarFooterAction "${slot.id}"`
        : `experimental_sidebarFooter item "${slot.id}"`,
      () =>
        slot.onActivate({
          openPluginDetails: () => {
            void navigate(
              getPluginConfigurationRoutePath({ pluginId: slot.pluginId }),
            );
          },
        }),
    );
  }
  function customize() {
    onNavigate?.();
    void navigate(getSettingsRoutePath("appearance"));
  }
  return (
    <>
      {items.map((item) =>
        item.kind === "plugin" ? (
          <FooterCommandObserver
            key={footerItemKey(item.slot)}
            item={item.slot}
            onDisclosureCommand={onDisclosureCommand}
          />
        ) : null,
      )}
      {items
        .filter((item) => !preferences.hidden.includes(item.key))
        .map((item) => {
          const builtin =
            item.kind === "builtin"
              ? builtInActions.find((action) => action.id === item.id)
              : undefined;
          const active =
            item.kind === "plugin" &&
            footerItemKey(item.slot) === activeDisclosureKey;
          const label = builtin?.ariaLabel ?? item.label;
          return (
            <ContextMenu key={item.key}>
              <ContextMenuTrigger asChild>
                <SidebarMenuItem
                  className="min-w-0"
                  data-footer-item={item.key}
                >
                  <SidebarMenuButton
                    asChild={builtin?.href !== undefined}
                    id={
                      item.kind === "plugin"
                        ? footerTriggerId(item.slot)
                        : `sidebar-footer-${item.id}`
                    }
                    aria-label={label}
                    aria-keyshortcuts={builtin?.ariaKeyShortcuts}
                    tooltip={{ children: label, hidden: false, side: "top" }}
                    className={cn(
                      SIDEBAR_FOOTER_ACTION_CLASS,
                      active &&
                        "bg-sidebar-accent text-sidebar-accent-foreground [&>[data-icon-root]]:opacity-100",
                    )}
                    data-testid={
                      item.kind === "plugin"
                        ? item.slot.source === "sidebarFooterAction"
                          ? `plugin-sidebar-footer-action-${item.slot.pluginId}-${item.slot.id}`
                          : `plugin-sidebar-footer-item-${item.slot.pluginId}-${item.slot.id}`
                        : undefined
                    }
                    {...(item.kind === "plugin" &&
                    item.slot.kind === "disclosure"
                      ? {
                          "aria-expanded": active,
                          "aria-controls": footerDisclosureId(item.slot),
                        }
                      : {})}
                    onClick={
                      builtin?.href === undefined
                        ? () => activate(item)
                        : undefined
                    }
                  >
                    {builtin?.href !== undefined ? (
                      <Link to={builtin.href} onClick={onNavigate}>
                        <FooterItemIcon item={item} />
                        <span className="sr-only">{item.label}</span>
                      </Link>
                    ) : (
                      <>
                        <FooterItemIcon item={item} />
                        <span className="sr-only">{item.label}</span>
                      </>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </ContextMenuTrigger>
              <ContextMenuContent
                onPointerUpCapture={(event) => {
                  if (event.button !== 0) event.preventDefault();
                }}
              >
                <ContextMenuItem
                  onSelect={() => preferences.setVisible(item.key, false)}
                >
                  <Icon name="EyeOff" />
                  Hide
                </ContextMenuItem>
                <ContextMenuItem onSelect={customize}>
                  Customize footer
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      {hidden.length > 0 ? (
        <SidebarMenuItem className="min-w-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                id={SIDEBAR_FOOTER_MORE_ID}
                aria-label="More footer actions"
                tooltip={{ children: "More", hidden: false, side: "top" }}
                className={SIDEBAR_FOOTER_ACTION_CLASS}
              >
                <Icon name="MoreHorizontal" />
                <span className="sr-only">More</span>
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              mobileTitle="More footer actions"
            >
              {hidden.map((item) => (
                <DropdownMenuItem
                  key={item.key}
                  onSelect={() => activate(item)}
                >
                  <FooterItemIcon item={item} />
                  {item.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={customize}>
                Customize footer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      ) : null}
    </>
  );
}

function FooterCommandObserver({
  item,
  onDisclosureCommand,
}: {
  item: PluginSidebarFooterItemSlot;
  onDisclosureCommand: (
    key: string,
    command: ExperimentalSidebarFooterCommandKind,
    sequence?: number,
  ) => void;
}) {
  const snapshot = useSyncExternalStore(
    item.runtime.subscribe,
    item.runtime.getSnapshot,
    item.runtime.getSnapshot,
  );
  const command = snapshot.command;
  useEffect(() => {
    if (command === null || item.kind !== "disclosure") return;
    onDisclosureCommand(footerItemKey(item), command.kind, command.sequence);
    item.runtime.acknowledgeCommand(command.sequence);
  }, [command, item, onDisclosureCommand]);
  return null;
}

export function FooterItemIcon({ item }: { item: FooterItem }) {
  return item.kind === "plugin" &&
    item.slot.source === "sidebarFooterAction" ? (
    <PluginIcon pluginId={item.slot.pluginId} icon={item.icon} />
  ) : (
    <Icon
      name={pluginIconName(item.icon)}
      className="size-4 shrink-0"
      aria-hidden="true"
    />
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
