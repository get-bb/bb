import { useEffect, useRef, type ReactNode } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/theme";
import { Icon, Text, type IconName } from "@/ui";

export interface ThreadSwipeAction {
  key: string;
  label: string;
  icon: IconName;
  /** Pane fill: a token string (the panes are Reanimated-driven views). */
  color: string;
  onPress: () => void;
}

interface ThreadRowSwipeableProps {
  /** Closes a recycled row when it starts showing another thread. */
  threadId: string;
  /** Revealed by swiping right; a full swipe runs it. */
  leading: ThreadSwipeAction;
  /** Revealed by swiping left, outermost last; a full swipe runs the last one. */
  trailing: readonly ThreadSwipeAction[];
  children: ReactNode;
}

const ACTION_WIDTH = 76;
/** Dragging past this share of the row width commits the outermost action. */
const FULL_SWIPE_RATIO = 0.55;

/**
 * Mail-style swipe actions on a thread row: leading (read / unread) and
 * trailing (pin, archive) panes behind the row, the outermost pane
 * stretching with the finger so a full swipe commits it without a tap.
 * Light haptic as a pane opens. Shared by the home list, search results
 * and the archive on both platforms (RNGH, no native dependency).
 */
export function ThreadRowSwipeable({
  threadId,
  leading,
  trailing,
  children,
}: ThreadRowSwipeableProps) {
  const swipeable = useRef<SwipeableMethods>(null);
  // The row's width, read on the UI thread to size the full-swipe threshold.
  const rowWidth = useSharedValue(0);
  // The pane a drag has committed to (1 leading, -1 trailing, 0 none),
  // decided on the UI thread while the finger is down: on release the
  // swipeable springs the translation back to the pane's open width before
  // `onSwipeableWillOpen` reaches the JS thread, so sampling the translation
  // there would miss the swipe.
  const committed = useSharedValue(0);

  useEffect(() => {
    swipeable.current?.reset();
  }, [threadId]);

  const onLayout = (event: LayoutChangeEvent) => {
    rowWidth.set(event.nativeEvent.layout.width);
  };

  const run = (action: ThreadSwipeAction) => {
    swipeable.current?.close();
    action.onPress();
  };

  const onWillOpen = () => {
    haptic("impact-light");
    const side = committed.get();
    if (side > 0) {
      run(leading);
    } else if (side < 0) {
      run(trailing[trailing.length - 1]);
    }
  };

  return (
    <View onLayout={onLayout}>
      <ReanimatedSwipeable
        ref={swipeable}
        renderLeftActions={(_progress, translation) => (
          <ActionPane
            side="left"
            actions={[leading]}
            translation={translation}
            rowWidth={rowWidth}
            committed={committed}
            onAction={run}
          />
        )}
        renderRightActions={(_progress, translation) => (
          <ActionPane
            side="right"
            actions={trailing}
            translation={translation}
            rowWidth={rowWidth}
            committed={committed}
            onAction={run}
          />
        )}
        onSwipeableWillOpen={onWillOpen}
      >
        {children}
      </ReanimatedSwipeable>
    </View>
  );
}

interface ActionPaneProps {
  side: "left" | "right";
  actions: readonly ThreadSwipeAction[];
  translation: SharedValue<number>;
  rowWidth: SharedValue<number>;
  committed: SharedValue<number>;
  onAction: (action: ThreadSwipeAction) => void;
}

/**
 * One side's actions. The swipeable measures the pane's natural width as
 * the open position; past it the pane keeps growing with the drag and the
 * outermost action fills the extra width (Mail's full-swipe affordance).
 * The pane also tracks, on the UI thread, whether the drag on its side has
 * crossed the full-swipe threshold.
 */
function ActionPane({
  side,
  actions,
  translation,
  rowWidth,
  committed,
  onAction,
}: ActionPaneProps) {
  const baseWidth = actions.length * ACTION_WIDTH;
  useAnimatedReaction(
    () => translation.get(),
    (value) => {
      // Each pane tracks the drag on its own side; a closed row clears.
      const revealed = side === "left" ? value : -value;
      if (revealed <= 0) {
        if (value === 0) committed.set(0);
        return;
      }
      const width = rowWidth.get();
      if (width > 0 && revealed >= width * FULL_SWIPE_RATIO) {
        committed.set(side === "left" ? 1 : -1);
      } else if (revealed < baseWidth - 1) {
        // Back under the pane's open width: only the finger gets here (a
        // released row springs down to that width and stops), so the full
        // swipe was cancelled.
        committed.set(0);
      }
    },
  );
  const stretch = useAnimatedStyle(() => {
    const revealed = side === "left" ? translation.get() : -translation.get();
    return { width: Math.max(baseWidth, revealed) };
  });
  const outermost = side === "left" ? 0 : actions.length - 1;
  return (
    <Animated.View style={[{ flexDirection: "row" }, stretch]}>
      {actions.map((action, index) => (
        <ActionButton
          key={action.key}
          action={action}
          side={side}
          stretch={index === outermost}
          onPress={() => onAction(action)}
        />
      ))}
    </Animated.View>
  );
}

function ActionButton({
  action,
  side,
  stretch,
  onPress,
}: {
  action: ThreadSwipeAction;
  side: "left" | "right";
  stretch: boolean;
  onPress: () => void;
}) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: action.color,
        opacity: pressed ? 0.8 : 1,
        width: stretch ? undefined : ACTION_WIDTH,
        flexGrow: stretch ? 1 : 0,
        justifyContent: "center",
        // The glyph stays by the row edge while the pane stretches.
        alignItems: side === "right" ? "flex-end" : "flex-start",
      })}
      testID={`thread-swipe-${action.key}`}
    >
      <View
        style={{
          width: ACTION_WIDTH,
          alignItems: "center",
          justifyContent: "center",
          gap: 3,
        }}
      >
        <Icon
          name={action.icon}
          size={22}
          weight="semibold"
          color={tokens.primaryForeground}
        />
        <Text
          variant="chrome"
          weight="medium"
          numberOfLines={1}
          style={{ color: tokens.primaryForeground }}
        >
          {action.label}
        </Text>
      </View>
    </Pressable>
  );
}
