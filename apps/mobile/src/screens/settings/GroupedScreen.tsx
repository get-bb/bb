import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { Screen } from "../shell/Screen";

interface GroupedScreenProps {
  children: ReactNode;
  /** Wrap content in a ScrollView (default). Lists supply their own. */
  scroll?: boolean;
  /** Extra scroll content container styles (merged after the grouped ones). */
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * `Screen` on the iOS grouped page color: every settings / management
 * screen is a stack of `GroupedSection` cards on `surface-grouped`. The
 * page color is painted by `Screen` itself (`surface="grouped"`) so the
 * header inset and overscroll regions match; the content container grows to
 * the viewport so short screens lay out against the whole page. The scroll
 * view itself still belongs to `Screen`.
 */
export function GroupedScreen({
  children,
  scroll,
  contentStyle,
  testID,
}: GroupedScreenProps) {
  return (
    <Screen
      scroll={scroll}
      surface="grouped"
      contentStyle={[{ flexGrow: 1 }, contentStyle]}
      testID={testID}
    >
      {children}
    </Screen>
  );
}
