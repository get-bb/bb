import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { ActionSheetAction } from "./ActionSheet";
import type { SFSymbol } from "./sf-symbol-map";

// Shared by NativeMenu.tsx (Android / default) and NativeMenu.ios.tsx. Lives in
// its own module because Metro resolves "./NativeMenu" to the .ios sibling on
// iOS, so the platform files must never import each other by basename.

/**
 * One menu item: the `ActionSheet` action shape (`key`, `label`, `icon?`,
 * `destructive?`, `disabled?`, `checked?`, `subtitle?`, `onPress`), so
 * existing action arrays pass straight through, plus the native-menu
 * extras: an explicit SF Symbol (`.fill` variants the icon map does not
 * carry) and nested `items` (a submenu, or an inline titled section with
 * `inline`). The Android sheet ignores `symbol` and flattens `items`.
 */
export interface NativeMenuAction extends ActionSheetAction {
  /** iOS only: overrides the symbol derived from `icon`. */
  symbol?: SFSymbol;
  /** Nested items: a submenu, or an inline section when `inline` is set. */
  items?: readonly NativeMenuAction[];
  /** Render `items` inline under this item's label as a section header. */
  inline?: boolean;
}

/** The sheet has no submenus: every nested item becomes a top-level row. */
export function flattenNativeMenuActions(
  actions: readonly NativeMenuAction[],
): ActionSheetAction[] {
  const rows: ActionSheetAction[] = [];
  for (const action of actions) {
    if (action.items && action.items.length > 0) {
      rows.push(...flattenNativeMenuActions(action.items));
      continue;
    }
    rows.push(action);
  }
  return rows;
}

/**
 * The rule: a native menu wraps only an icon-only button. On iOS the menu
 * host removes the wrapped React Native subtree from the accessibility
 * tree (verified with Maestro hierarchy dumps): VoiceOver and XCUITest see
 * one element — the host — with the host's own label, and nothing inside
 * it. Anything that shows text (list rows, option pills, chips, value
 * rows) is a `Pressable` that presents an `ActionSheet` / `OptionSheet` on
 * both platforms instead.
 */
export interface NativeMenuProps {
  /** Menu heading (iOS draws it as the first section's title). */
  title?: string;
  actions: readonly NativeMenuAction[];
  /**
   * Fires as the menu opens on the fallback path only (haptics, lazy
   * data). The native iOS menu exposes no open hook and adds its own
   * haptic.
   */
  onOpen?: () => void;
  /** Open on long-press (context menu) instead of tap. */
  longPress?: boolean;
  /** Renders the trigger inert. */
  disabled?: boolean;
  /** The trigger: a glyph in a sized `View`, never text. */
  children: ReactNode;
  /**
   * Names the trigger for VoiceOver and Maestro — the host is the single
   * accessible element; the glyph inside it is not one. Pass it on every
   * menu (it falls back to `title` only so older call sites keep a name).
   */
  accessibilityLabel?: string;
  /** The host wrapper's style. */
  style?: StyleProp<ViewStyle>;
  /** Lands on the host, the one element the accessibility tree keeps. */
  testID?: string;
}
