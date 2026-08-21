import type { SidebarSectionId } from "@bb/client-core";
import { useCallback, useEffect, useMemo } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import type { SidebarSectionOrderEntry } from "@/data/sidebar";
import { haptic } from "@/lib/haptics/haptics";
import { useTheme } from "@/theme";
import { Icon, Text } from "@/ui";

/** Fixed so a row's slot is `index × height` and the drag math stays in a worklet. */
const SECTION_REORDER_ROW_HEIGHT = 48;
const LIFT_SCALE = 1.02;
const SPRING = { damping: 22, stiffness: 260, mass: 0.8 };

interface SectionReorderListProps {
  entries: readonly SidebarSectionOrderEntry[];
  /** Fires once per drop with the full new order. */
  onReorder: (order: SidebarSectionId[]) => void;
}

/**
 * Drag-to-reorder list of the top-level sidebar sections (web: dragging a
 * section label in the sidebar). Rows live in absolute slots; the active row
 * follows the finger and the others spring into their new slot as the finger
 * crosses a row midpoint. The order commits on drop only, so the caller can
 * persist without chatter. Touch the handle to lift at once; the rest of the
 * row lifts after a short hold so taps still pass through.
 */
export function SectionReorderList({
  entries,
  onReorder,
}: SectionReorderListProps) {
  const ids = useMemo(() => entries.map((entry) => entry.id), [entries]);
  // id -> slot index. Shared so every row's style reads it on the UI thread.
  const slots = useSharedValue<Record<string, number>>(
    Object.fromEntries(ids.map((id, index) => [id, index])),
  );
  const activeId = useSharedValue<string | null>(null);
  const dragY = useSharedValue(0);

  // New entries (or a reorder coming back from the store) reset the slots.
  useEffect(() => {
    slots.value = Object.fromEntries(ids.map((id, index) => [id, index]));
  }, [ids, slots]);

  const commit = useCallback(
    (nextSlots: Record<string, number>) => {
      const order = [...ids].sort(
        (left, right) => (nextSlots[left] ?? 0) - (nextSlots[right] ?? 0),
      );
      if (order.some((id, index) => id !== ids[index])) onReorder(order);
    },
    [ids, onReorder],
  );
  const tick = useCallback(() => haptic("selection"), []);
  const lift = useCallback(() => haptic("impact-light"), []);

  return (
    <View
      style={{ height: ids.length * SECTION_REORDER_ROW_HEIGHT }}
      testID="section-reorder-list"
    >
      {entries.map((entry) => (
        <SectionReorderRow
          key={entry.id}
          entry={entry}
          count={ids.length}
          slots={slots}
          activeId={activeId}
          dragY={dragY}
          onCommit={commit}
          onTick={tick}
          onLift={lift}
        />
      ))}
    </View>
  );
}

interface SectionReorderRowProps {
  entry: SidebarSectionOrderEntry;
  count: number;
  slots: SharedValue<Record<string, number>>;
  activeId: SharedValue<string | null>;
  dragY: SharedValue<number>;
  onCommit: (slots: Record<string, number>) => void;
  onTick: () => void;
  onLift: () => void;
}

function SectionReorderRow({
  entry,
  count,
  slots,
  activeId,
  dragY,
  onCommit,
  onTick,
  onLift,
}: SectionReorderRowProps) {
  const { tokens, radii } = useTheme();
  const id = entry.id;
  const startSlot = useSharedValue(0);

  const moveTo = (nextIndex: number) => {
    "worklet";
    const current = slots.value[id] ?? 0;
    if (nextIndex === current) return;
    const next = { ...slots.value };
    for (const [otherId, otherIndex] of Object.entries(next)) {
      if (otherId === id) continue;
      if (
        current < nextIndex &&
        otherIndex > current &&
        otherIndex <= nextIndex
      )
        next[otherId] = otherIndex - 1;
      else if (
        current > nextIndex &&
        otherIndex >= nextIndex &&
        otherIndex < current
      )
        next[otherId] = otherIndex + 1;
    }
    next[id] = nextIndex;
    slots.value = next;
    runOnJS(onTick)();
  };

  const begin = () => {
    "worklet";
    startSlot.value = slots.value[id] ?? 0;
    activeId.value = id;
    dragY.value = startSlot.value * SECTION_REORDER_ROW_HEIGHT;
    runOnJS(onLift)();
  };
  const update = (translationY: number) => {
    "worklet";
    const y = startSlot.value * SECTION_REORDER_ROW_HEIGHT + translationY;
    dragY.value = y;
    const target = Math.min(
      count - 1,
      Math.max(0, Math.round(y / SECTION_REORDER_ROW_HEIGHT)),
    );
    moveTo(target);
  };
  const finish = () => {
    "worklet";
    activeId.value = null;
    runOnJS(onCommit)(slots.value);
  };

  // The handle lifts at once; the row body after a short hold, so a tap on
  // the row body does nothing and a scroll gesture above us is not stolen.
  const handlePan = Gesture.Pan()
    .onBegin(begin)
    .onUpdate((event) => update(event.translationY))
    .onFinalize(finish);
  const rowPan = Gesture.Pan()
    .activateAfterLongPress(180)
    // A touch that lands on the handle belongs to the handle pan alone.
    .requireExternalGestureToFail(handlePan)
    .onStart(begin)
    .onUpdate((event) => update(event.translationY))
    .onFinalize(() => {
      if (activeId.value === id) finish();
    });

  const style = useAnimatedStyle(() => {
    const isActive = activeId.value === id;
    const slotY = (slots.value[id] ?? 0) * SECTION_REORDER_ROW_HEIGHT;
    return {
      transform: [
        { translateY: isActive ? dragY.value : withSpring(slotY, SPRING) },
        { scale: withTiming(isActive ? LIFT_SCALE : 1, { duration: 120 }) },
      ],
      zIndex: isActive ? 2 : 0,
      shadowOpacity: withTiming(isActive ? 0.18 : 0, { duration: 120 }),
      backgroundColor: isActive ? tokens.popover : "transparent",
    };
  });

  return (
    <GestureDetector gesture={rowPan}>
      <Animated.View
        accessibilityRole="button"
        accessibilityLabel={`${entry.label}, ${entry.threadCount} threads`}
        accessibilityHint="Drag to reorder"
        className="absolute left-0 right-0 flex-row items-center pr-4"
        style={[
          {
            height: SECTION_REORDER_ROW_HEIGHT,
            borderRadius: radii.md,
            shadowColor: "#000",
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
          },
          style,
        ]}
        testID={`section-reorder-row-${id}`}
      >
        <GestureDetector gesture={handlePan}>
          <View
            className="h-full w-12 items-center justify-center"
            accessibilityLabel={`Reorder ${entry.label}`}
            testID={`section-reorder-handle-${id}`}
          >
            <Icon
              name="DragDropVertical"
              size={18}
              color={tokens.subtleForeground}
            />
          </View>
        </GestureDetector>
        <Text variant="label" numberOfLines={1} className="min-w-0 flex-1">
          {entry.label}
        </Text>
        <View className="rounded-sm bg-surface-selected px-1.5 py-px">
          <Text variant="chrome">{entry.threadCount}</Text>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}
