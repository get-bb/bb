import { MenuView, type MenuAction } from "@expo/ui/community/menu";
import { View } from "react-native";
import { sfSymbolFor } from "./sf-symbol-map";
import type { NativeMenuAction, NativeMenuProps } from "./native-menu-shared";

function toMenuAction(action: NativeMenuAction): MenuAction {
  const symbol =
    action.symbol ?? (action.icon ? sfSymbolFor(action.icon) : undefined);
  const disabled = action.disabled === true;
  return {
    id: action.key,
    // The native item has no subtitle line: a disabled item folds its
    // subtitle (the reason it is unavailable) into the title so the
    // explanation survives; enabled items drop their description.
    title:
      disabled && action.subtitle
        ? `${action.label} — ${action.subtitle}`
        : action.label,
    // Brand marks (Discord, Github) have no symbol; the item renders text-only.
    ...(symbol ? { image: symbol } : {}),
    // `state` switches the item to a toggle row; leave it off for commands.
    ...(action.checked === undefined
      ? {}
      : { state: action.checked ? ("on" as const) : ("off" as const) }),
    attributes: {
      destructive: action.destructive === true,
      disabled,
    },
    ...(action.items && action.items.length > 0
      ? {
          subactions: action.items.map(toMenuAction),
          displayInline: action.inline === true,
        }
      : {}),
  };
}

/** Every leaf item, so a submenu pick resolves to its own handler. */
function findAction(
  actions: readonly NativeMenuAction[],
  key: string,
): NativeMenuAction | undefined {
  for (const action of actions) {
    if (action.key === key) return action;
    const nested = action.items ? findAction(action.items, key) : undefined;
    if (nested) return nested;
  }
  return undefined;
}

/**
 * iOS: a native pull-down menu (tap) or context menu (`longPress`) anchored
 * to the trigger, built from `@expo/ui`'s `MenuView`.
 *
 * The rule (see `NativeMenuProps`): the trigger is an icon-only button. The
 * SwiftUI menu host drops the wrapped React Native subtree from the
 * accessibility tree, so an `accessible` wrapper is the one element
 * VoiceOver and Maestro see — it carries the label, the button role, the
 * disabled state and the `testID`; activating it (a tap at its centre)
 * reaches the native menu underneath. The menu items themselves are native
 * and stay accessible. Icons come from the SF Symbol map; the native menu
 * has no `subtitle` line, so only a disabled item keeps it (folded into the
 * title as the reason it is unavailable). Metro picks this file on iOS;
 * `NativeMenu.tsx` is the fallback.
 */
export function NativeMenu({
  title,
  actions,
  longPress = false,
  disabled = false,
  children,
  style,
  testID,
  accessibilityLabel,
}: NativeMenuProps) {
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled }}
      style={style}
      testID={testID}
    >
      {disabled ? (
        children
      ) : (
        <MenuView
          title={title}
          actions={actions.map(toMenuAction)}
          onPressAction={({ nativeEvent }) => {
            findAction(actions, nativeEvent.event)?.onPress();
          }}
          shouldOpenOnLongPress={longPress}
        >
          {children}
        </MenuView>
      )}
    </View>
  );
}

export {
  flattenNativeMenuActions,
  type NativeMenuAction,
  type NativeMenuProps,
} from "./native-menu-shared";
