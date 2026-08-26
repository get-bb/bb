import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/theme";
import {
  ActionSheet,
  Icon,
  Text,
  useSheet,
  type ActionSheetAction,
  type IconName,
} from "@/ui";
import type { PanelStripEntry, PanelStripTarget } from "./panel-model";

const IS_IOS = process.env.EXPO_OS === "ios";
/** Capsule height of one strip entry (the iOS filter-bar pill). */
const PILL_HEIGHT = 32;
/** Longest label before it truncates (file names). */
const LABEL_MAX_WIDTH = 140;

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
 * File tabs read as documents on iOS (one glyph for every file kind, like a
 * Files app tab row); the fixed entries keep their own symbols.
 */
function stripEntryIcon(entry: PanelStripEntry): IconName {
  return IS_IOS && entry.closable ? "File" : entry.icon;
}

/**
 * The workspace panel's tab strip as an iOS pill bar: the fixed entries
 * (Info, Diff, Files, Terminal) then the closable file tabs, the active one
 * a filled capsule. Switching tabs ticks the selection haptic; a file tab's
 * close actions (Close / Close others / Close all) are a long-press action
 * sheet shared by every tab (a native context menu per tab would host a
 * SwiftUI view in each pill). The active entry scrolls into view when it
 * changes.
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

  const closeActionsFor = useCallback(
    (tabId: string): ActionSheetAction[] => [
      {
        key: "close",
        label: "Close tab",
        icon: "X",
        onPress: () => onCloseTab(tabId),
      },
      {
        key: "close-others",
        label: "Close other tabs",
        icon: "CircleX",
        onPress: () => onCloseOtherTabs(tabId),
      },
      {
        key: "close-all",
        label: "Close all tabs",
        icon: "Trash2",
        destructive: true,
        onPress: () => onCloseAllTabs(),
      },
    ],
    [onCloseAllTabs, onCloseOtherTabs, onCloseTab],
  );

  const openMenu = useCallback(
    (entry: PanelStripEntry) => {
      haptic("impact-heavy");
      setMenuEntry(entry);
      menu.present();
    },
    [menu],
  );

  const activate = useCallback(
    (entry: PanelStripEntry) => {
      if (!entry.active) haptic("selection");
      onActivate(entry.target);
    },
    [onActivate],
  );

  const menuTabId =
    menuEntry?.target.kind === "tab" ? menuEntry.target.tabId : null;

  return (
    <View
      style={{
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: tokens.borderHairline,
      }}
      testID="workspace-panel-tab-strip"
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.strip}
      >
        {entries.map((entry) => {
          const closableTabId =
            entry.closable && entry.target.kind === "tab"
              ? entry.target.tabId
              : null;
          return (
            // A direct child of the scroll content, so its layout x is the
            // offset the scroll-into-view needs.
            <View
              key={entry.key}
              onLayout={(event) => {
                offsetsRef.current.set(entry.key, event.nativeEvent.layout.x);
              }}
              style={[
                styles.pill,
                {
                  backgroundColor: entry.active
                    ? tokens.secondary
                    : "transparent",
                },
              ]}
            >
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: entry.active }}
                accessibilityLabel={
                  entry.statusLabel
                    ? `${entry.label} (${entry.statusLabel})`
                    : entry.label
                }
                onPress={() => activate(entry)}
                onLongPress={
                  closableTabId !== null ? () => openMenu(entry) : undefined
                }
                style={({ pressed }) => [
                  styles.pillPress,
                  {
                    paddingRight: closableTabId === null ? 12 : 4,
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
                testID={stripEntryTestId(entry)}
              >
                <Icon
                  name={stripEntryIcon(entry)}
                  size={16}
                  weight={entry.active ? "semibold" : "medium"}
                  color={
                    entry.active ? tokens.foreground : tokens.mutedForeground
                  }
                />
                <Text
                  variant="body"
                  weight={entry.active ? "semibold" : "regular"}
                  tone={entry.active ? "foreground" : "muted"}
                  numberOfLines={1}
                  style={styles.label}
                >
                  {entry.label}
                </Text>
                {entry.statusLabel ? (
                  <Text variant="caption" numberOfLines={1}>
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
                  style={({ pressed }) => [
                    styles.close,
                    { opacity: pressed ? 0.5 : 1 },
                  ]}
                  testID="panel-tab-close"
                >
                  <Icon
                    name="CircleX"
                    symbol="xmark.circle.fill"
                    size={16}
                    color={tokens.subtleForeground}
                  />
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      <ActionSheet
        controller={menu}
        title={menuEntry?.label}
        actions={menuTabId === null ? [] : closeActionsFor(menuTabId)}
        onDismiss={() => setMenuEntry(null)}
        stackBehavior="push"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    borderCurve: "continuous",
  },
  pillPress: {
    height: PILL_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 12,
  },
  close: {
    height: PILL_HEIGHT,
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { maxWidth: LABEL_MAX_WIDTH },
});
