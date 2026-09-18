import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { TabPill } from "@/components/ui/tab-pill";
import { PANEL_TAB_CONTROL_CLASS } from "./panelChromeClasses";

const MAX_TAB_WIDTH_PX = 144;
const TAB_GAP_PX = 4;

interface MobilePanelTab {
  id: string;
  label: string;
  ariaLabel: string;
  leadingVisual: ReactNode;
  onSelect: () => void;
  onClose: (() => void) | null;
}

interface MobilePanelTabPagerProps {
  activeTabId: string | null;
  fixedTabs: readonly Omit<MobilePanelTab, "onClose">[];
  tabs: readonly MobilePanelTab[];
  newTabControl: ReactNode;
}

export function MobilePanelTabPager({
  activeTabId,
  fixedTabs,
  tabs,
  newTabControl,
}: MobilePanelTabPagerProps) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const navigationRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeContentTabId = activeTab?.id ?? null;
  const [lastContentTabId, setLastContentTabId] = useState(activeContentTabId);
  const displayedIndex = Math.max(
    0,
    tabs.findIndex(
      (tab) => tab.id === (activeContentTabId ?? lastContentTabId),
    ),
  );
  const [visible, setVisible] = useState({
    start: displayedIndex,
    end: displayedIndex + 1,
    width: MAX_TAB_WIDTH_PX,
    offset: 0,
    available: MAX_TAB_WIDTH_PX,
  });
  const previousTab = tabs[displayedIndex - 1];
  const nextTab = tabs[displayedIndex + 1];

  useEffect(() => {
    if (activeContentTabId !== null) setLastContentTabId(activeContentTabId);
  }, [activeContentTabId]);

  useLayoutEffect(() => {
    const navigation = navigationRef.current;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!navigation || !viewport || !content) return;
    const measure = () => {
      if (navigation.clientWidth === 0) {
        setVisible((previous) =>
          previous.start === displayedIndex
            ? previous
            : {
                ...previous,
                start: displayedIndex,
                end: displayedIndex + 1,
              },
        );
        return;
      }
      const controls = Array.from(navigation.children).filter(
        (child) => child !== viewport,
      );
      const available = Math.max(
        0,
        navigation.clientWidth -
          controls.reduce(
            (width, child) => width + child.getBoundingClientRect().width,
            0,
          ) -
          controls.length * TAB_GAP_PX,
      );
      const widths = Array.from(content.children, (child) =>
        Math.min(available, child.getBoundingClientRect().width),
      );
      const offsets = [0];
      for (const width of widths)
        offsets.push(offsets[offsets.length - 1] + width + TAB_GAP_PX);
      setVisible((previous) => {
        let start = Math.min(previous.start, displayedIndex);
        const total = (from: number, to: number) =>
          to > from ? offsets[to] - offsets[from] - TAB_GAP_PX : 0;
        while (
          start < displayedIndex &&
          total(start, displayedIndex + 1) > available
        )
          start++;
        let end = Math.min(
          widths.length,
          Math.max(start + 1, displayedIndex + 1),
        );
        while (end < widths.length && total(start, end + 1) <= available) end++;
        while (start > 0 && total(start - 1, end) <= available) start--;
        const width = total(start, end);
        const offset = offsets[start];
        if (
          previous.start === start &&
          previous.end === end &&
          previous.width === width &&
          previous.offset === offset &&
          previous.available === available
        )
          return previous;
        return { start, end, width, offset, available };
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(navigation);
    observer.observe(content);
    return () => observer.disconnect();
  }, [displayedIndex, tabs]);

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-2"
      data-testid="mobile-panel-tab-pager"
    >
      <div className="flex shrink-0 items-center gap-1 [&_button]:size-8 max-md:pointer-coarse:[&_button]:size-9">
        {fixedTabs.map((tab) => (
          <TabPill
            compact
            key={tab.id}
            label={tab.label}
            ariaLabel={tab.ariaLabel}
            iconOnly
            leadingVisual={tab.leadingVisual}
            title={tab.label}
            isActive={tab.id === activeTabId}
            onSelect={tab.onSelect}
            closeAction={null}
          />
        ))}
      </div>
      <div
        ref={navigationRef}
        className="flex min-w-0 flex-1 items-center gap-1"
      >
        <Button
          variant="ghost"
          size="icon"
          className={`${PANEL_TAB_CONTROL_CLASS} text-muted-foreground/70`}
          aria-label="Previous tab"
          disabled={previousTab === undefined}
          onClick={() => previousTab?.onSelect()}
        >
          <Icon name="ChevronLeft" />
        </Button>
        <div
          ref={viewportRef}
          data-testid="mobile-panel-tab-viewport"
          data-no-secondary-panel-swipe
          className="min-w-0 shrink-0 touch-pan-y overflow-hidden [&_[data-tab-pill-close]]:text-muted-foreground/70 [&_[data-tab-pill-close]_[data-icon-root]]:size-3.5"
          style={{
            width: Math.min(visible.width, visible.available),
          }}
          onTouchStartCapture={(event) => {
            suppressClickUntil.current = 0;
            const touch = event.touches[0];
            touchStart.current =
              event.touches.length === 1 && touch
                ? { x: touch.clientX, y: touch.clientY }
                : null;
          }}
          onTouchCancelCapture={() => {
            touchStart.current = null;
          }}
          onTouchEndCapture={(event) => {
            const start = touchStart.current;
            touchStart.current = null;
            const touch = event.changedTouches[0];
            if (!start || !touch) return;
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (Math.abs(dx) < 30 || Math.abs(dx) <= Math.abs(dy)) return;
            suppressClickUntil.current = Date.now() + 500;
            (dx < 0 ? nextTab : previousTab)?.onSelect();
          }}
          onClickCapture={(event) => {
            if (Date.now() >= suppressClickUntil.current) return;
            suppressClickUntil.current = 0;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div
            ref={contentRef}
            className="flex w-max items-center gap-1"
            style={{ transform: `translateX(-${visible.offset}px)` }}
          >
            {tabs.map((displayedTab, index) => (
              <div
                key={displayedTab.id}
                data-panel-tab-measure
                className="flex shrink-0"
                style={{
                  maxWidth: Math.min(MAX_TAB_WIDTH_PX, visible.available),
                  visibility:
                    index >= visible.start && index < visible.end
                      ? undefined
                      : "hidden",
                }}
                inert={index < visible.start || index >= visible.end}
              >
                <TabPill
                  compact
                  label={displayedTab.label}
                  ariaLabel={displayedTab.ariaLabel}
                  leadingVisual={displayedTab.leadingVisual}
                  title={displayedTab.label}
                  isActive={displayedTab === activeTab}
                  onSelect={displayedTab.onSelect}
                  labelMaxWidthClass="max-w-full"
                  enlargeCloseTargetOnCoarsePointer
                  closeAction={
                    displayedTab.onClose === null
                      ? null
                      : {
                          onClose: displayedTab.onClose,
                          closeLabel: `Close ${displayedTab.label}`,
                        }
                  }
                />
              </div>
            ))}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className={`${PANEL_TAB_CONTROL_CLASS} text-muted-foreground/70`}
          aria-label="Next tab"
          disabled={nextTab === undefined}
          onClick={() => nextTab?.onSelect()}
        >
          <Icon name="ChevronRight" />
        </Button>
        {newTabControl}
      </div>
    </div>
  );
}
