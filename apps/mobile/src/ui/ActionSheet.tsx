import { Fragment } from "react";
import { Pressable, View } from "react-native";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/theme/ThemeProvider";
import { cn } from "./cn";
import { Button } from "./Button";
import { GROUPED_CARD_RADIUS } from "./Grouped";
import { Icon, type IconName } from "./Icon";
import { ListRow, LIST_ROW_ICON_SIZE } from "./ListRow";
import { Separator, SEPARATOR_INSET } from "./Separator";
import { Sheet, type SheetController } from "./Sheet";
import { Text } from "./Text";

const IS_IOS = process.env.EXPO_OS === "ios";

export interface ActionSheetAction {
  key: string;
  label: string;
  icon?: IconName;
  destructive?: boolean;
  disabled?: boolean;
  dismissOnPress?: boolean;
  onPress: () => void;
}

export interface ActionSheetProps {
  controller: SheetController;
  presentation?: "menu" | "prompt";
  title?: string;
  message?: string;
  status?: string;
  cancelLabel?: string | null;
  actions: readonly ActionSheetAction[];
  onDismiss?: () => void;
}

const ACTION_SEPARATOR_INSET = SEPARATOR_INSET + LIST_ROW_ICON_SIZE + 12;

export function ActionSheet({
  controller,
  presentation = "menu",
  title,
  message,
  status,
  cancelLabel = "Cancel",
  actions,
  onDismiss,
}: ActionSheetProps) {
  const { tokens } = useTheme();
  const hasHeader = Boolean(title || message || status);
  const hasIcons = actions.some((action) => action.icon);
  if (!IS_IOS && presentation === "menu") {
    return (
      <Sheet controller={controller} onDismiss={onDismiss}>
        <View className="px-5 pb-2">
          {hasHeader ? (
            <View className="items-center gap-1 pb-3 pt-1">
              <View className="flex-row items-center justify-center gap-3">
                {title ? (
                  <Text
                    weight="semibold"
                    numberOfLines={1}
                    className="shrink text-center"
                  >
                    {title}
                  </Text>
                ) : null}
                {status ? (
                  <View className="flex-row items-center gap-1 rounded-full bg-surface-recessed-solid px-2 py-0.5">
                    <Icon
                      name="Check"
                      size={12}
                      color={tokens.mutedForeground}
                    />
                    <Text variant="caption">{status}</Text>
                  </View>
                ) : null}
              </View>
              {message ? (
                <Text
                  variant="caption"
                  numberOfLines={2}
                  className="text-center"
                >
                  {message}
                </Text>
              ) : null}
            </View>
          ) : null}
          {hasHeader ? <Separator inset={0} /> : null}
          <View className="pt-1">
            {actions.map((action) => (
              <Pressable
                key={action.key}
                accessibilityRole="button"
                accessibilityState={{ disabled: !!action.disabled }}
                disabled={action.disabled}
                testID={`action-sheet-${action.key}`}
                onPress={() => {
                  if (action.destructive) haptic("warning");
                  if (action.dismissOnPress !== false) controller.dismiss();
                  action.onPress();
                }}
                className={cn(
                  "min-h-12 flex-row items-center gap-3 rounded-lg py-3 active:bg-state-hover",
                  action.disabled && "opacity-50",
                )}
              >
                <Text
                  className="flex-1 text-center"
                  tone={action.destructive ? "destructive" : "default"}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}
            {cancelLabel ? (
              <Button
                variant="ghost"
                onPress={controller.dismiss}
                testID="action-sheet-cancel"
              >
                {cancelLabel}
              </Button>
            ) : null}
          </View>
        </View>
      </Sheet>
    );
  }
  if (!IS_IOS) {
    return (
      <Sheet controller={controller} onDismiss={onDismiss}>
        <View className="gap-5 px-6 pb-4 pt-3">
          {hasHeader ? (
            <View className="items-center gap-2">
              {actions[0]?.icon ? (
                <View className="mb-2 h-12 w-12 items-center justify-center rounded-full bg-surface-recessed-solid">
                  <Icon name={actions[0].icon} size={24} />
                </View>
              ) : null}
              {title ? (
                <Text variant="heading" className="text-center">
                  {title}
                </Text>
              ) : null}
              {message ? (
                <Text tone="muted" className="text-center">
                  {message}
                </Text>
              ) : null}
              {status ? (
                <View className="flex-row items-center gap-1.5 pt-1">
                  <Icon name="Check" size={16} color={tokens.success} />
                  <Text variant="caption" tone="success">
                    {status}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
          <View className="gap-2">
            {actions.map((action, index) => {
              const onPress = () => {
                if (action.destructive) haptic("warning");
                if (action.dismissOnPress !== false) controller.dismiss();
                action.onPress();
              };
              return (
                <Button
                  key={action.key}
                  variant={
                    index === 0 && !action.destructive ? "default" : "ghost"
                  }
                  className={
                    action.destructive ? "bg-destructive/10" : undefined
                  }
                  disabled={action.disabled}
                  testID={`action-sheet-${action.key}`}
                  onPress={onPress}
                >
                  {action.destructive ? (
                    <Text className="text-sm font-medium" tone="destructive">
                      {action.label}
                    </Text>
                  ) : (
                    action.label
                  )}
                </Button>
              );
            })}
            {cancelLabel ? (
              <Button
                variant="ghost"
                onPress={controller.dismiss}
                testID="action-sheet-cancel"
              >
                {cancelLabel}
              </Button>
            ) : null}
          </View>
        </View>
      </Sheet>
    );
  }
  const card = {
    borderRadius: GROUPED_CARD_RADIUS,
    borderCurve: "continuous" as const,
  };
  return (
    <Sheet controller={controller} onDismiss={onDismiss}>
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
              {status ? (
                <Text variant="caption" className="text-center">
                  {status}
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
                onPress={() => {
                  if (action.destructive) haptic("warning");
                  if (action.dismissOnPress !== false) controller.dismiss();
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
