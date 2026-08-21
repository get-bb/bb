import {
  FlashList,
  type FlashListRef,
  type ListRenderItemInfo,
} from "@shopify/flash-list";
import {
  createElement,
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  Pressable,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useTheme } from "@/theme";
import { Button, Icon, Spinner, Text } from "@/ui";
import {
  type TimelineListEntry,
} from "./list-entries";
import { getTimelineRowRenderer } from "./renderers";
// Registers the row renderers (side effect) before the first cell renders.
import "./renderers/index";
import type { TimelineListItem } from "./rows";
import {
  INITIAL_STICKY_BOTTOM_STATE,
  reduceStickyBottom,
  resolveInitialScrollTarget,
  shouldFollowContentGrowth,
  shouldShowJumpToLatest,
  type ScrollMetrics,
  type StickyBottomState,
} from "./sticky-bottom";

export interface TimelineListHandle {
  scrollToEnd(): void;
}

interface TimelineListProps {
  entries: readonly TimelineListEntry[];
  /** Index of the unread divider entry, or -1. */
  unreadDividerIndex: number;
  /**
   * Start at the divider (not the end). Read once, at mount: mount the list
   * only after the thread's read state is known.
   */
  unreadDividerAutoScroll: boolean;
  /** Toggle one row's disclosure (`item.expanded`); keep it referentially stable. */
  onToggleRow: (rowId: string) => void;
  threadId: string;
  projectId: string;
  hasOlderRows: boolean;
  isLoadingOlderRows: boolean;
  onLoadOlderRows: () => Promise<void>;
  /** Rendered after the last row (working indicator). */
  footer?: ReactElement | null;
  /** Extra space under the footer (bottom bar height). */
  bottomInset: number;
  testID?: string;
}

/** Start fetching this far (in viewports) before the top is reached. */
const AUTO_LOAD_OLDER_THRESHOLD_VIEWPORTS = 1;
/** Follow-up scrolls closer together than this snap instead of animate. */
const SMOOTH_FOLLOW_MIN_GAP_MS = 250;
const MAINTAIN_POSITION = { startRenderingFromBottom: true };

function metricsFromScrollEvent(
  event: NativeSyntheticEvent<NativeScrollEvent>,
): ScrollMetrics {
  const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
  return {
    contentHeight: contentSize.height,
    offsetY: contentOffset.y,
    viewportHeight: layoutMeasurement.height,
  };
}

function UnreadDividerRow() {
  return (
    <View
      className="flex-row items-center gap-2 px-4 py-1"
      testID="timeline-unread-divider"
    >
      <Text
        variant="chrome"
        weight="medium"
        className="uppercase tracking-wider text-timeline-accent"
      >
        New
      </Text>
      <View className="h-px flex-1 bg-timeline-accent" />
    </View>
  );
}

function keyExtractor(entry: TimelineListEntry): string {
  return entry.key;
}

function getItemType(entry: TimelineListEntry): string {
  return entry.type === "row" ? entry.item.kind : entry.type;
}

interface TimelineRowCellProps {
  item: TimelineListItem;
  onToggleRow: (rowId: string) => void;
  threadId: string;
  projectId: string;
}

/**
 * One row cell. Memoized on the item identity (`buildTimelineListItems`
 * reuses unchanged items), so during streaming only the rows whose data
 * changed re-render. The renderer is keyed by the item key: FlashList
 * recycles cells of one item type across different rows, and the row bodies
 * keep local disclosure state (terminal tail, diff "show more", image load)
 * that must not leak from one row to the next.
 */
const TimelineRowCell = memo(function TimelineRowCell({
  item,
  onToggleRow,
  threadId,
  projectId,
}: TimelineRowCellProps) {
  const rowId = item.viewRow.id;
  const onToggle = useCallback(() => onToggleRow(rowId), [onToggleRow, rowId]);
  // The renderer is looked up per kind from the registry (a module-level
  // table, not a component created here); `createElement` keeps the lookup
  // out of JSX so the compiler does not read it as an inline component.
  return createElement(getTimelineRowRenderer(item.kind), {
    key: item.key,
    item,
    expanded: item.expanded,
    onToggle,
    threadId,
    projectId,
  });
});

/**
 * The virtualized timeline: rows in reading order, sticky-bottom following
 * while the reader is at the end (pure policy in `sticky-bottom.ts`), a
 * "jump to latest" button once they scroll up, older pages loaded when the
 * top comes near, the unread divider, and the working indicator footer.
 * Mount one per thread (key it by thread id): the scroll story starts over
 * with the component.
 */
export const TimelineList = forwardRef<TimelineListHandle, TimelineListProps>(
  function TimelineList(
    {
      entries,
      unreadDividerIndex,
      unreadDividerAutoScroll,
      onToggleRow,
      threadId,
      projectId,
      hasOlderRows,
      isLoadingOlderRows,
      onLoadOlderRows,
      footer,
      bottomInset,
      testID,
    },
    ref,
  ) {
    const { tokens } = useTheme();
    const listRef = useRef<FlashListRef<TimelineListEntry>>(null);
    // Decided once at mount and handed to FlashList as its initial render
    // position (`initialScrollIndex` / `startRenderingFromBottom`); an
    // imperative scroll after the first layout would fight the list's own
    // anchoring while rows are still being measured.
    const [initialTarget] = useState(() =>
      resolveInitialScrollTarget({
        itemCount: entries.length,
        unreadDividerAutoScroll,
        unreadDividerIndex,
      }),
    );
    const stickyRef = useRef<StickyBottomState>(
      initialTarget?.kind === "index"
        ? reduceStickyBottom(INITIAL_STICKY_BOTTOM_STATE, { type: "detach" })
        : INITIAL_STICKY_BOTTOM_STATE,
    );
    const metricsRef = useRef<ScrollMetrics>({
      contentHeight: 0,
      offsetY: 0,
      viewportHeight: 0,
    });
    const lastFollowAtRef = useRef(0);
    const [showJumpToLatest, setShowJumpToLatest] = useState(false);
    const [autoLoadFailed, setAutoLoadFailed] = useState(false);

    const syncJumpToLatest = useCallback(() => {
      const next = shouldShowJumpToLatest(
        stickyRef.current,
        metricsRef.current,
      );
      setShowJumpToLatest((current) => (current === next ? current : next));
    }, []);

    const scrollToEndNow = useCallback((animated: boolean) => {
      listRef.current?.scrollToEnd({ animated });
    }, []);

    const startLoadOlder = useCallback(() => {
      if (!hasOlderRows || isLoadingOlderRows || autoLoadFailed) return;
      void onLoadOlderRows().catch(() => {
        // Stop auto-loading so a persistently failing page is not re-requested
        // in a loop; the header button offers a manual retry.
        setAutoLoadFailed(true);
      });
    }, [autoLoadFailed, hasOlderRows, isLoadingOlderRows, onLoadOlderRows]);

    const retryLoadOlder = useCallback(() => {
      setAutoLoadFailed(false);
      void onLoadOlderRows().catch(() => setAutoLoadFailed(true));
    }, [onLoadOlderRows]);

    const handleScroll = useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const metrics = metricsFromScrollEvent(event);
        metricsRef.current = metrics;
        stickyRef.current = reduceStickyBottom(stickyRef.current, {
          type: "scroll",
          metrics,
        });
        syncJumpToLatest();
      },
      [syncJumpToLatest],
    );
    const handleScrollBeginDrag = useCallback(() => {
      stickyRef.current = reduceStickyBottom(stickyRef.current, {
        type: "drag-start",
      });
    }, []);
    const handleScrollEndDrag = useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const velocityY = event.nativeEvent.velocity?.y ?? 0;
        const metrics = metricsFromScrollEvent(event);
        metricsRef.current = metrics;
        stickyRef.current = reduceStickyBottom(stickyRef.current, {
          type: "drag-end",
          metrics,
          willDecelerate: Math.abs(velocityY) > 0.05,
        });
        syncJumpToLatest();
      },
      [syncJumpToLatest],
    );
    const handleMomentumScrollEnd = useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const metrics = metricsFromScrollEvent(event);
        metricsRef.current = metrics;
        stickyRef.current = reduceStickyBottom(stickyRef.current, {
          type: "momentum-end",
          metrics,
        });
        syncJumpToLatest();
      },
      [syncJumpToLatest],
    );

    const handleContentSizeChange = useCallback(
      (_width: number, height: number) => {
        metricsRef.current = { ...metricsRef.current, contentHeight: height };
        if (shouldFollowContentGrowth(stickyRef.current, metricsRef.current)) {
          const now = Date.now();
          const animated =
            now - lastFollowAtRef.current >= SMOOTH_FOLLOW_MIN_GAP_MS;
          lastFollowAtRef.current = now;
          scrollToEndNow(animated);
        } else if (
          hasOlderRows &&
          metricsRef.current.viewportHeight > 0 &&
          height <= metricsRef.current.viewportHeight
        ) {
          // A page that does not fill the viewport never triggers
          // onStartReached again; keep paging until it does.
          startLoadOlder();
        }
        syncJumpToLatest();
      },
      [hasOlderRows, scrollToEndNow, startLoadOlder, syncJumpToLatest],
    );

    const handleLayout = useCallback((event: LayoutChangeEvent) => {
      metricsRef.current = {
        ...metricsRef.current,
        viewportHeight: event.nativeEvent.layout.height,
      };
    }, []);

    const jumpToLatest = useCallback(() => {
      stickyRef.current = reduceStickyBottom(stickyRef.current, {
        type: "jump-to-latest",
      });
      setShowJumpToLatest(false);
      scrollToEndNow(true);
    }, [scrollToEndNow]);

    useImperativeHandle(
      ref,
      () => ({ scrollToEnd: jumpToLatest }),
      [jumpToLatest],
    );

    const renderItem = useCallback(
      ({ item: entry }: ListRenderItemInfo<TimelineListEntry>) => {
        if (entry.type === "unread-divider") return <UnreadDividerRow />;
        return (
          <TimelineRowCell
            item={entry.item}
            onToggleRow={onToggleRow}
            threadId={threadId}
            projectId={projectId}
          />
        );
      },
      [onToggleRow, projectId, threadId],
    );

    const header = useMemo(() => {
      if (isLoadingOlderRows) {
        return (
          <View className="items-center py-3" testID="timeline-loading-older">
            <Spinner size="small" color={tokens.mutedForeground} />
          </View>
        );
      }
      if (hasOlderRows && autoLoadFailed) {
        return (
          <View className="items-center py-2">
            <Button variant="ghost" size="sm" onPress={retryLoadOlder}>
              Load older messages
            </Button>
          </View>
        );
      }
      return <View className="h-2" />;
    }, [
      autoLoadFailed,
      hasOlderRows,
      isLoadingOlderRows,
      retryLoadOlder,
      tokens.mutedForeground,
    ]);

    const footerNode = useMemo(
      () => (
        <View style={{ paddingBottom: bottomInset }}>
          {footer ?? null}
          <View className="h-3" />
        </View>
      ),
      [bottomInset, footer],
    );

    return (
      <View className="flex-1" onLayout={handleLayout}>
        <FlashList
          ref={listRef}
          data={entries}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          renderItem={renderItem}
          initialScrollIndex={
            initialTarget?.kind === "index" ? initialTarget.index : undefined
          }
          onScroll={handleScroll}
          scrollEventThrottle={32}
          onScrollBeginDrag={handleScrollBeginDrag}
          onScrollEndDrag={handleScrollEndDrag}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          onContentSizeChange={handleContentSizeChange}
          onStartReached={startLoadOlder}
          onStartReachedThreshold={AUTO_LOAD_OLDER_THRESHOLD_VIEWPORTS}
          // Chat layout: without an initial index the first render starts at
          // the bottom; prepends (older pages) keep the first visible row
          // anchored (default).
          maintainVisibleContentPosition={MAINTAIN_POSITION}
          ListHeaderComponent={header}
          ListFooterComponent={footerNode}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          testID={testID}
        />
        {showJumpToLatest ? (
          <View
            pointerEvents="box-none"
            className="absolute bottom-3 left-0 right-0 items-center"
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Jump to latest"
              onPress={jumpToLatest}
              className="h-9 flex-row items-center gap-1.5 rounded-full border border-border bg-popover pl-3 pr-4 active:bg-state-hover"
              style={{
                shadowColor: tokens.ink,
                shadowOpacity: 0.18,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 2 },
                elevation: 3,
              }}
              testID="timeline-jump-to-latest"
            >
              <Icon name="ArrowDown" size={16} color={tokens.foreground} />
              <Text variant="label">Jump to latest</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  },
);
