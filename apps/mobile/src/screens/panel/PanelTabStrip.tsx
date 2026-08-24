import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useTheme } from "@/theme";
import {
  ActionSheet,
  cn,
  Icon,
  Text,
  useSheet,
  type ActionSheetAction,
} from "@/ui";
import type { PanelStripEntry, PanelStripTarget } from "./panel-model";

interface PanelTabStripProps {
  entries: readonly PanelStripEntry[];
  onActivate: (target: PanelStripTarget) => void;
  onCloseTab: (tabId: string) => void;
  onCloseOtherTabs: (tabId: string) => void;
  onCloseAllTabs: () => void;
}

function stripEntryTestId(entry: PanelStripEntry): string {
  if (entry.target.kind === "launcher") {
    return `panel-tab-${entry.target.launcher}`;
  }
  const kindPrefix = entry.target.tabId.split(":")[0] ?? "tab";
  return entry.closable
    ? `panel-tab-file-${kindPrefix}`
    : `panel-tab-${kindPrefix}`;
}

/**
 * Horizontal tab strip of the workspace panel: fixed entries (Info, Diff,
 * Files, Terminal) then closable file tabs with an "x"; long-press a file
 * tab for Close / Close others / Close all. The active entry scrolls into
 * view when it changes.
 */
export function PanelTabStrip({
  entries,
  onActivate,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
}: PanelTabStripProps) {
  const { tokens } = useTheme();
  const menu = useSheet();
  const [menuEntry, setMenuEntry] = useState<PanelStripEntry | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const offsetsRef = useRef(new Map<string, number>());
  const activeKey = entries.find((entry) => entry.active)?.key ?? null;

  useEffect(() => {
    if (activeKey === null) return;
    const x = offsetsRef.current.get(activeKey);
    if (x === undefined) return;
    scrollRef.current?.scrollTo({ x: Math.max(0, x - 48), animated: true });
  }, [activeKey]);

  const openMenu = useCallback(
    (entry: PanelStripEntry) => {
      setMenuEntry(entry);
      menu.present();
    },
    [menu],
  );

  const menuTabId =
    menuEntry?.target.kind === "tab" ? menuEntry.target.tabId : null;
  const menuActions: ActionSheetAction[] =
    menuTabId === null
      ? []
      : [
          {
            key: "close",
            label: "Close tab",
            icon: "X",
            onPress: () => onCloseTab(menuTabId),
          },
          {
            key: "close-others",
            label: "Close other tabs",
            onPress: () => onCloseOtherTabs(menuTabId),
          },
          {
            key: "close-all",
            label: "Close all tabs",
            destructive: true,
            onPress: () => onCloseAllTabs(),
          },
        ];

  return (
    <View
      className="border-b border-border-hairline"
      testID="workspace-panel-tab-strip"
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          gap: 6,
          alignItems: "center",
        }}
      >
        {entries.map((entry) => {
          const closableTabId =
            entry.closable && entry.target.kind === "tab"
              ? entry.target.tabId
              : null;
          return (
            <View
              key={entry.key}
              onLayout={(event) => {
                offsetsRef.current.set(entry.key, event.nativeEvent.layout.x);
              }}
              className={cn(
                "flex-row items-center rounded-md border",
                entry.active
                  ? "border-border bg-surface-selected"
                  : "border-transparent",
              )}
            >
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: entry.active }}
                accessibilityLabel={
                  entry.statusLabel
                    ? `${entry.label} (${entry.statusLabel})`
                    : entry.label
                }
                onPress={() => onActivate(entry.target)}
                onLongPress={entry.closable ? () => openMenu(entry) : undefined}
                className={cn(
                  "h-8 flex-row items-center gap-1.5 rounded-md pl-2.5 active:bg-state-hover",
                  entry.closable ? "pr-1" : "pr-2.5",
                )}
                testID={stripEntryTestId(entry)}
              >
                <Icon
                  name={entry.icon}
                  size={14}
                  color={
                    entry.active ? tokens.foreground : tokens.mutedForeground
                  }
                />
                <Text
                  className={cn(
                    "max-w-[140px] text-xs",
                    entry.active ? "text-foreground" : "text-muted-foreground",
                  )}
                  numberOfLines={1}
                >
                  {entry.label}
                </Text>
                {entry.statusLabel ? (
                  <Text
                    className="text-2xs text-muted-foreground"
                    numberOfLines={1}
                  >
                    {entry.statusLabel}
                  </Text>
                ) : null}
              </Pressable>
              {closableTabId !== null ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Close ${entry.label}`}
                  hitSlop={6}
                  onPress={() => onCloseTab(closableTabId)}
                  className="h-8 w-7 items-center justify-center rounded-md active:bg-state-hover"
                  testID="panel-tab-close"
                >
                  <Icon name="X" size={12} color={tokens.mutedForeground} />
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      <ActionSheet
        controller={menu}
        title={menuEntry?.label}
        actions={menuActions}
        onDismiss={() => setMenuEntry(null)}
        stackBehavior="push"
      />
    </View>
  );
}
