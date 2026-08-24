import { Pressable, ScrollView, View } from "react-native";
import { useTheme } from "@/theme";
import { cn, Icon, Text, type IconName } from "@/ui";
import type { TerminalAccessoryKey } from "./terminal-bridge";

/**
 * The key bar above the soft keyboard: keys a phone keyboard lacks (Esc, Tab,
 * arrows, Home / End, shell punctuation), a sticky Ctrl modifier applied to
 * the next key, and paste from the clipboard. Always visible under the
 * terminal so the arrows work without the keyboard too.
 */

interface TerminalAccessoryBarProps {
  ctrlActive: boolean;
  onToggleCtrl: () => void;
  onKey: (key: TerminalAccessoryKey) => void;
  onPaste: () => void;
  /** Raise the keyboard (focus the page's textarea). */
  onKeyboard?: () => void;
  /**
   * Terminal actions (rename / restart / new / close). Full screen only: it
   * duplicates the header's "…" so the menu is reachable one-handed and in
   * landscape.
   */
  onMenu?: () => void;
  testID?: string;
}

interface AccessoryItem {
  id: string;
  label?: string;
  icon?: IconName;
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
    accessibilityLabel: "Arrow left",
    key: "ArrowLeft",
  },
  { id: "ArrowUp", label: "↑", accessibilityLabel: "Arrow up", key: "ArrowUp" },
  {
    id: "ArrowDown",
    label: "↓",
    accessibilityLabel: "Arrow down",
    key: "ArrowDown",
  },
  {
    id: "ArrowRight",
    label: "→",
    accessibilityLabel: "Arrow right",
    key: "ArrowRight",
  },
  { id: "Home", label: "home", accessibilityLabel: "Home", key: "Home" },
  { id: "End", label: "end", accessibilityLabel: "End", key: "End" },
  { id: "-", label: "-", accessibilityLabel: "Minus", key: "-" },
  { id: "/", label: "/", accessibilityLabel: "Slash", key: "/" },
  { id: "|", label: "|", accessibilityLabel: "Pipe", key: "|" },
  { id: "paste", icon: "Copy", accessibilityLabel: "Paste" },
];

export function TerminalAccessoryBar({
  ctrlActive,
  onToggleCtrl,
  onKey,
  onPaste,
  onKeyboard,
  onMenu,
  testID,
}: TerminalAccessoryBarProps) {
  const { tokens } = useTheme();
  return (
    <View
      className="flex-row items-center border-t border-border bg-sidebar"
      testID={testID}
    >
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 6,
          paddingVertical: 6,
          gap: 6,
        }}
        className="flex-1"
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
                if (isCtrl) onToggleCtrl();
                else if (item.id === "paste") onPaste();
                else if (item.key) onKey(item.key);
              }}
              className={cn(
                "h-9 min-w-9 items-center justify-center rounded-md border px-2.5 active:bg-state-active",
                active
                  ? "border-foreground bg-foreground"
                  : "border-border bg-background",
              )}
            >
              {item.icon ? (
                <Icon name={item.icon} size={16} color={tokens.foreground} />
              ) : (
                <Text
                  mono
                  className={cn(
                    "text-sm",
                    active ? "text-background" : "text-foreground",
                  )}
                >
                  {item.label}
                </Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
      {onMenu ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Terminal actions"
          testID="terminal-key-menu"
          onPress={onMenu}
          className="h-9 w-10 items-center justify-center border-l border-border active:bg-state-active"
        >
          <Icon
            name="MoreHorizontal"
            size={16}
            color={tokens.mutedForeground}
          />
        </Pressable>
      ) : null}
      {onKeyboard ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show keyboard"
          testID="terminal-key-keyboard"
          onPress={onKeyboard}
          className="h-9 w-10 items-center justify-center border-l border-border active:bg-state-active"
        >
          <Icon name="ChevronUp" size={16} color={tokens.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}
