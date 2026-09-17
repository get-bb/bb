import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { TabPill } from "@/components/ui/tab-pill";

interface MobilePanelTab {
  id: string;
  label: string;
  ariaLabel: string;
  iconOnly: boolean;
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
  const [tabWidths, setTabWidths] = useState<readonly number[]>([]);
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  const activeTab = tabs[activeIndex];
  const previousTab = tabs[activeIndex - 1];
  const nextTab = activeIndex < 0 ? undefined : tabs[activeIndex + 1];
  const remainingTabs = activeIndex < 0 ? [] : tabs.slice(activeIndex);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(viewport).columnGap) || 0;
      let available = viewport.clientWidth;
      const widths: number[] = [];
      for (const child of viewport.children) {
        const button = child.querySelector<HTMLButtonElement>(
          "button[aria-pressed]",
        );
        if (!button) continue;
        const label = button.querySelector(".truncate");
        const naturalWidth =
          button.offsetWidth +
          (label ? Math.max(0, label.scrollWidth - label.clientWidth) : 0);
        if (
          widths.length > 0 &&
          (available <= 0 || available < Math.min(naturalWidth, 80))
        ) {
          break;
        }
        const width = Math.min(naturalWidth, Math.max(0, available));
        widths.push(width);
        available -= width + gap;
      }
      setTabWidths((current) =>
        current.length === widths.length &&
        current.every((width, index) => width === widths[index])
          ? current
          : widths,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    for (const button of viewport.querySelectorAll("button[aria-pressed]")) {
      observer.observe(button);
    }
    return () => observer.disconnect();
  }, [activeTab?.id, tabs]);

  return (
    <div
      className="flex min-w-0 flex-1 items-center"
      data-testid="mobile-panel-tab-pager"
    >
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
        ref={viewportRef}
        data-testid="mobile-panel-tab-viewport"
        className="relative flex min-w-0 flex-1 touch-pan-y items-center gap-1 overflow-hidden [&_[data-tab-pill-close]]:text-muted-foreground/70 [&_[data-tab-pill-close]_[data-icon-root]]:size-3.5"
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
        {remainingTabs.map((tab, index) => {
          const visible = index === 0 || index < tabWidths.length;
          return (
            <div
              key={tab.id}
              aria-hidden={!visible}
              inert={!visible}
              style={{
                maxWidth: visible ? (tabWidths[index] ?? "100%") : undefined,
              }}
              className={
                visible
                  ? "flex min-w-0 shrink-0"
                  : "pointer-events-none invisible absolute flex w-max shrink-0"
              }
            >
              <TabPill
                label={tab.label}
                ariaLabel={tab.ariaLabel}
                iconOnly={tab.iconOnly}
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
          );
        })}
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
  );
}
