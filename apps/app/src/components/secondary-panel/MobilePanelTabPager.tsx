import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { TabPill } from "@/components/ui/tab-pill";

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
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeContentTabId = activeTab?.id ?? null;
  const [lastContentTabId, setLastContentTabId] = useState(activeContentTabId);
  const displayedIndex = Math.max(
    0,
    tabs.findIndex(
      (tab) => tab.id === (activeContentTabId ?? lastContentTabId),
    ),
  );
  const displayedTab = tabs[displayedIndex];
  const previousTab = tabs[displayedIndex - 1];
  const nextTab = tabs[displayedIndex + 1];

  useEffect(() => {
    if (activeContentTabId !== null) setLastContentTabId(activeContentTabId);
  }, [activeContentTabId]);

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1"
      data-testid="mobile-panel-tab-pager"
    >
      <div className="flex shrink-0 items-center gap-0.5">
        {fixedTabs.map((tab) => (
          <TabPill
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
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-7 shrink-0 text-muted-foreground/70 [&_[data-icon-root]]:size-3.5"
          aria-label="Previous tab"
          disabled={previousTab === undefined}
          onClick={() => previousTab?.onSelect()}
        >
          <Icon name="ChevronLeft" />
        </Button>
        <div
          data-testid="mobile-panel-tab-viewport"
          className="flex min-w-0 flex-1 touch-pan-y items-center justify-center overflow-hidden [&_[data-tab-pill-close]]:text-muted-foreground/70 [&_[data-tab-pill-close]_[data-icon-root]]:size-3.5"
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
          {displayedTab && (
            <TabPill
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
          )}
        </div>
        {newTabControl}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-7 shrink-0 text-muted-foreground/70 [&_[data-icon-root]]:size-3.5"
          aria-label="Next tab"
          disabled={nextTab === undefined}
          onClick={() => nextTab?.onSelect()}
        >
          <Icon name="ChevronRight" />
        </Button>
      </div>
    </div>
  );
}
