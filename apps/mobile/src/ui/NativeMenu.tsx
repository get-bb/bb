import { Pressable } from "react-native";
import { ActionSheet } from "./ActionSheet";
import {
  flattenNativeMenuActions,
  type NativeMenuProps,
} from "./native-menu-shared";
import { useSheet } from "./Sheet";

/**
 * Android / default: the trigger is wrapped in a Pressable that presents an
 * `ActionSheet` with the same actions (`NativeMenu.ios.tsx` renders a
 * native `MenuView`). The same rule applies on both platforms: the trigger
 * is an icon-only button and the wrapper is the accessible element, named
 * by `accessibilityLabel`. Because the wrapper owns the gesture, a trigger
 * that is itself a Pressable with the same gesture claims the touch first
 * — text-bearing rows keep their own `Pressable` + `ActionSheet` instead.
 */
export function NativeMenu({
  title,
  actions,
  onOpen,
  longPress = false,
  disabled = false,
  children,
  style,
  testID,
  accessibilityLabel,
}: NativeMenuProps) {
  const sheet = useSheet();
  const open = () => {
    onOpen?.();
    sheet.present();
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={longPress ? undefined : open}
        onLongPress={longPress ? open : undefined}
        style={style}
        testID={testID}
      >
        {children}
      </Pressable>
      <ActionSheet
        controller={sheet}
        title={title}
        actions={flattenNativeMenuActions(actions)}
      />
    </>
  );
}

export {
  flattenNativeMenuActions,
  type NativeMenuAction,
  type NativeMenuProps,
} from "./native-menu-shared";
