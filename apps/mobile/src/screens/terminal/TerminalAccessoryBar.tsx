import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/theme";
import {
  Icon,
  NativeMenu,
  Text,
  type IconName,
  type NativeMenuAction,
  type SFSymbol,
} from "@/ui";
import type { TerminalAccessoryKey } from "./terminal-bridge";

const IS_IOS = process.env.EXPO_OS === "ios";
/** Key cap metrics (the iOS keyboard accessory row). */
const KEY_HEIGHT = 34;
const KEY_MIN_WIDTH = 38;
const KEY_RADIUS = 6;
/** The trailing "…" / keyboard buttons. */
const BAR_BUTTON_WIDTH = 44;

/**
 * The key bar above the soft keyboard: keys a phone keyboard lacks (Esc, Tab,
 * arrows, Home / End, shell punctuation), a sticky Ctrl modifier applied to
 * the next key, and paste from the clipboard. Always visible under the
 * terminal so the arrows work without the keyboard too. Styled as an iOS
 * keyboard accessory strip: key caps on the raised surface, the sticky Ctrl
 * tinted, a selection tick per key.
 */

interface TerminalAccessoryBarProps {
  ctrlActive: boolean;
  onToggleCtrl: () => void;
  onKey: (key: TerminalAccessoryKey) => void;
  onPaste: () => void;
  /** Toggle the soft keyboard (focus / blur the page's textarea). */
  onKeyboard?: () => void;
  /** Whether the keyboard is up: picks the show / hide glyph. */
  keyboardVisible?: boolean;
  /**
   * Android: opens the terminal actions sheet (rename / restart / new /
   * close). Full screen only: it duplicates the header's "…" so the menu is
   * reachable one-handed and in landscape.
   */
  onMenu?: () => void;
  /** iOS: the same actions as a native menu anchored to the "…" key. */
  menuActions?: readonly NativeMenuAction[];
  testID?: string;
}

interface AccessoryItem {
  id: string;
  /** Key cap text (also the Android glyph when only `symbol` is set). */
  label?: string;
  /** Glyph on both platforms (SF on iOS through the icon map). */
  icon?: IconName;
  /** iOS glyph for caps whose symbol is not in the icon map (`arrow.left`, `doc.on.clipboard`). */
  symbol?: SFSymbol;
  accessibilityLabel: string;
  key?: TerminalAccessoryKey;
}

const ITEMS: readonly AccessoryItem[] = [
  { id: "Escape", label: "esc", accessibilityLabel: "Escape", key: "Escape" },
  { id: "Tab", label: "tab", accessibilityLabel: "Tab", key: "Tab" },
  { id: "ctrl", label: "ctrl", accessibilityLabel: "Control" },
  {
    id: "ArrowLeft",
    label: "←",
    symbol: "arrow.left",
    accessibilityLabel: "Arrow left",
    key: "ArrowLeft",
  },
  {
    id: "ArrowUp",
    label: "↑",
    symbol: "arrow.up",
    accessibilityLabel: "Arrow up",
    key: "ArrowUp",
  },
  {
    id: "ArrowDown",
    label: "↓",
    symbol: "arrow.down",
    accessibilityLabel: "Arrow down",
    key: "ArrowDown",
  },
  {
    id: "ArrowRight",
    label: "→",
    symbol: "arrow.right",
    accessibilityLabel: "Arrow right",
    key: "ArrowRight",
  },
  { id: "Home", label: "home", accessibilityLabel: "Home", key: "Home" },
  { id: "End", label: "end", accessibilityLabel: "End", key: "End" },
  { id: "-", label: "-", accessibilityLabel: "Minus", key: "-" },
  { id: "/", label: "/", accessibilityLabel: "Slash", key: "/" },
  { id: "|", label: "|", accessibilityLabel: "Pipe", key: "|" },
  {
    id: "paste",
    icon: "Copy",
    symbol: "doc.on.clipboard",
    accessibilityLabel: "Paste",
  },
];

function KeyGlyph({ item, color }: { item: AccessoryItem; color: string }) {
  if (item.icon !== undefined || (IS_IOS && item.symbol !== undefined)) {
    return (
      <Icon
        name={item.icon ?? "ArrowRight"}
        symbol={item.symbol}
        size={18}
        color={color}
      />
    );
  }
  return (
    <Text variant="body" style={{ color }}>
      {item.label}
    </Text>
  );
}

export function TerminalAccessoryBar({
  ctrlActive,
  onToggleCtrl,
  onKey,
  onPaste,
  onKeyboard,
  keyboardVisible = false,
  onMenu,
  menuActions,
  testID,
}: TerminalAccessoryBarProps) {
  const { tokens } = useTheme();
  const menuGlyph = (
    <Icon
      name="MoreHorizontal"
      symbol="ellipsis.circle"
      size={22}
      color={tokens.primary}
    />
  );
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: tokens.surfaceRaisedSolid,
          borderTopColor: tokens.borderHairline,
        },
      ]}
      testID={testID}
    >
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.keys}
        style={styles.scroll}
      >
        {ITEMS.map((item) => {
          const isCtrl = item.id === "ctrl";
          const active = isCtrl && ctrlActive;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.accessibilityLabel}
              accessibilityState={isCtrl ? { selected: ctrlActive } : undefined}
              testID={`terminal-key-${item.id}`}
              onPress={() => {
                haptic("selection");
                if (isCtrl) onToggleCtrl();
                else if (item.id === "paste") onPaste();
                else if (item.key) onKey(item.key);
              }}
              style={({ pressed }) => [
                styles.key,
                {
                  backgroundColor: active ? tokens.primary : tokens.secondary,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <KeyGlyph
                item={item}
                color={active ? tokens.primaryForeground : tokens.foreground}
              />
            </Pressable>
          );
        })}
      </ScrollView>
      {menuActions ? (
        // An icon-only trigger: the menu host is the accessible element
        // (label, role, testID); the glyph view inside is not.
        <NativeMenu
          actions={menuActions}
          accessibilityLabel="Terminal actions"
          testID="terminal-key-menu"
        >
          <View style={styles.barButton}>{menuGlyph}</View>
        </NativeMenu>
      ) : onMenu ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Terminal actions"
          testID="terminal-key-menu"
          onPress={onMenu}
          style={({ pressed }) => [
            styles.barButton,
            { opacity: pressed ? 0.5 : 1 },
          ]}
        >
          {menuGlyph}
        </Pressable>
      ) : null}
      {onKeyboard ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            keyboardVisible ? "Hide keyboard" : "Show keyboard"
          }
          testID="terminal-key-keyboard"
          onPress={() => {
            haptic("selection");
            onKeyboard();
          }}
          style={({ pressed }) => [
            styles.barButton,
            { opacity: pressed ? 0.5 : 1 },
          ]}
        >
          <Icon
            name={keyboardVisible ? "ChevronDown" : "ChevronUp"}
            symbol={
              keyboardVisible ? "keyboard.chevron.compact.down" : "keyboard"
            }
            size={22}
            color={tokens.primary}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  scroll: { flex: 1 },
  keys: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
  },
  key: {
    height: KEY_HEIGHT,
    minWidth: KEY_MIN_WIDTH,
    paddingHorizontal: 10,
    borderRadius: KEY_RADIUS,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
  },
  barButton: {
    width: BAR_BUTTON_WIDTH,
    height: KEY_HEIGHT + 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
