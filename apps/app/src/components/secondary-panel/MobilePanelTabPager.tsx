import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  tabs: readonly MobilePanelTab[];
  newTabControl: ReactNode;
}

export function MobilePanelTabPager({
  activeTabId,
  tabs,
  newTabControl,
}: MobilePanelTabPagerProps) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLDivElement>(null);
  const [showNextTab, setShowNextTab] = useState(false);
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  const activeTab = tabs[activeIndex];
  const previousTab = tabs[activeIndex - 1];
  const nextTab = activeIndex < 0 ? undefined : tabs[activeIndex + 1];

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const selected = activeTabRef.current;
    if (!viewport || !selected) return;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(viewport).columnGap) || 0;
      setShowNextTab(viewport.clientWidth - selected.offsetWidth - gap >= 96);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(selected);
    return () => observer.disconnect();
  }, [activeTab?.id]);

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1"
      data-testid="mobile-panel-tab-pager"
    >
      <Button
        variant="ghost"
        size="icon"
        className="size-9 shrink-0 text-muted-foreground/70 [&_[data-icon-root]]:size-3.5"
        aria-label="Previous tab"
        disabled={previousTab === undefined}
        onClick={() => previousTab?.onSelect()}
      >
        <Icon name="ChevronLeft" />
      </Button>
      <div
        ref={viewportRef}
        data-testid="mobile-panel-tab-viewport"
        className="flex min-w-0 flex-1 touch-pan-y items-center gap-1 overflow-hidden [&_[data-tab-pill-close]]:text-muted-foreground/70 [&_[data-tab-pill-close]_[data-icon-root]]:size-3.5"
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
        {activeTab
          ? [activeTab, ...(showNextTab && nextTab ? [nextTab] : [])].map(
              (tab) => (
                <div
                  key={tab.id}
                  ref={tab === activeTab ? activeTabRef : undefined}
                  className={
                    tab === activeTab
                      ? "flex min-w-0 max-w-full shrink-0"
                      : "flex min-w-0 flex-1"
                  }
                >
                  <TabPill
                    label={tab.label}
                    ariaLabel={tab.ariaLabel}
                    leadingVisual={tab.leadingVisual}
                    title={tab.label}
                    isActive={tab === activeTab}
                    onSelect={tab.onSelect}
                    labelMaxWidthClass="max-w-full"
                    enlargeCloseTargetOnCoarsePointer
                    closeAction={
                      tab.onClose === null
                        ? null
                        : {
                            onClose: tab.onClose,
                            closeLabel: `Close ${tab.label}`,
                          }
                    }
                  />
                </div>
              ),
            )
          : null}
      </div>
      {newTabControl}
      <Button
        variant="ghost"
        size="icon"
        className="size-9 shrink-0 text-muted-foreground/70 [&_[data-icon-root]]:size-3.5"
        aria-label="Next tab"
        disabled={nextTab === undefined}
        onClick={() => nextTab?.onSelect()}
      >
        <Icon name="ChevronRight" />
      </Button>
    </div>
  );
}
