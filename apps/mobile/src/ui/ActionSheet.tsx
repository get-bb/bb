import { Fragment } from "react";
import { Pressable, View } from "react-native";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/theme/ThemeProvider";
import { cn } from "./cn";
import { GROUPED_CARD_RADIUS } from "./Grouped";
import { Icon, type IconName } from "./Icon";
import { ListRow, LIST_ROW_ICON_SIZE } from "./ListRow";
import { Separator, SEPARATOR_INSET } from "./Separator";
import { Sheet, type SheetController, type SheetProps } from "./Sheet";
import { Text } from "./Text";

const IS_IOS = process.env.EXPO_OS === "ios";

export interface ActionSheetAction {
  key: string;
  label: string;
  /** Secondary line under the label (the fallback sheet only; native menus drop it). */
  subtitle?: string;
  icon?: IconName;
  destructive?: boolean;
  disabled?: boolean;
  /** Current choice in a single-select menu (check mark). Omit for commands. */
  checked?: boolean;
  /** Runs after the sheet starts dismissing. */
  onPress: () => void;
}

export interface ActionSheetProps {
  controller: SheetController;
  title?: string;
  message?: string;
  actions: readonly ActionSheetAction[];
  onDismiss?: () => void;
  /** `"push"` keeps a presenting sheet in place underneath (default: switch). */
  stackBehavior?: SheetProps["stackBehavior"];
}

/** Separator inset past a leading glyph to the label column. */
const ACTION_SEPARATOR_INSET = SEPARATOR_INSET + LIST_ROW_ICON_SIZE + 12;

/**
 * A list of actions in a bottom sheet, styled like the system action
 * sheet: a card of 17pt rows (SF glyphs, destructive in red) and a separate
 * Cancel card. On iOS this is the long-list / Android fallback — short,
 * button-anchored menus use `NativeMenu`, confirmations `confirmDestructive`.
 * Present it through `useSheet()`:
 *
 *   const menu = useSheet();
 *   <ActionSheet controller={menu} actions={[…]} />  … onLongPress={menu.present}
 */
export function ActionSheet({
  controller,
  title,
  message,
  actions,
  onDismiss,
  stackBehavior,
}: ActionSheetProps) {
  const { tokens } = useTheme();
  const hasHeader = Boolean(title || message);
  const hasIcons = actions.some((action) => action.icon);
  const card = {
    borderRadius: GROUPED_CARD_RADIUS,
    borderCurve: "continuous" as const,
  };
  return (
    <Sheet
      controller={controller}
      onDismiss={onDismiss}
      stackBehavior={stackBehavior}
      surface="grouped"
    >
      <View className="gap-2 px-4 pt-1">
        <View className="overflow-hidden bg-surface-grouped-cell" style={card}>
          {hasHeader ? (
            <View className="items-center gap-0.5 px-4 pb-3 pt-3">
              {title ? (
                <Text
                  variant="footnote"
                  tone="muted"
                  weight="semibold"
                  numberOfLines={2}
                  className="text-center"
                >
                  {title}
                </Text>
              ) : null}
              {message ? (
                <Text variant="caption" className="text-center">
                  {message}
                </Text>
              ) : null}
            </View>
          ) : null}
          {actions.map((action, index) => (
            <Fragment key={action.key}>
              {index > 0 || hasHeader ? (
                <Separator
                  inset={hasIcons ? ACTION_SEPARATOR_INSET : SEPARATOR_INSET}
                />
              ) : null}
              <ListRow
                title={action.label}
                subtitle={action.subtitle}
                leading={
                  action.icon ? (
                    <Icon
                      name={action.icon}
                      size={LIST_ROW_ICON_SIZE}
                      color={
                        action.destructive
                          ? tokens.destructiveText
                          : tokens.foreground
                      }
                    />
                  ) : undefined
                }
                destructive={action.destructive}
                disabled={action.disabled}
                selected={action.checked === true}
                onPress={() => {
                  // A destructive row is a confirmation step: warn physically.
                  if (action.destructive) haptic("warning");
                  controller.dismiss();
                  action.onPress();
                }}
                testID={`action-sheet-${action.key}`}
              />
            </Fragment>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={controller.dismiss}
          className={cn(
            "min-h-[50px] items-center justify-center overflow-hidden bg-surface-grouped-cell px-4",
            IS_IOS ? "active:bg-state-active" : "active:bg-state-hover",
          )}
          style={card}
          testID="action-sheet-cancel"
        >
          <Text variant="bodyLarge" weight="semibold" tone="primary">
            Cancel
          </Text>
        </Pressable>
      </View>
    </Sheet>
  );
}
