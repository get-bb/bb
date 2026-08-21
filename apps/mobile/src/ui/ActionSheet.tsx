import { View } from "react-native";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/theme/ThemeProvider";
import { Icon, type IconName } from "./Icon";
import { ListRow } from "./ListRow";
import { Separator } from "./Separator";
import { Sheet, type SheetController, type SheetProps } from "./Sheet";
import { Text } from "./Text";

export interface ActionSheetAction {
  key: string;
  label: string;
  icon?: IconName;
  destructive?: boolean;
  disabled?: boolean;
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

/**
 * A list of actions in a bottom sheet (long-press menus, "…" menus). Present
 * it through `useSheet()`:
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
  return (
    <Sheet
      controller={controller}
      onDismiss={onDismiss}
      stackBehavior={stackBehavior}
    >
      {hasHeader ? (
        <View className="gap-1 px-4 pb-3 pt-1">
          {title ? (
            <Text variant="heading" numberOfLines={2}>
              {title}
            </Text>
          ) : null}
          {message ? <Text variant="caption">{message}</Text> : null}
        </View>
      ) : null}
      {hasHeader ? <Separator /> : null}
      {actions.map((action) => (
        <ListRow
          key={action.key}
          title={action.label}
          leading={
            action.icon ? (
              <Icon
                name={action.icon}
                size={20}
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
            // A destructive row is a confirmation step: warn physically.
            if (action.destructive) haptic("warning");
            controller.dismiss();
            action.onPress();
          }}
          testID={`action-sheet-${action.key}`}
        />
      ))}
      <Separator />
      <ListRow
        title="Cancel"
        onPress={controller.dismiss}
        className="justify-center"
        testID="action-sheet-cancel"
      />
    </Sheet>
  );
}
