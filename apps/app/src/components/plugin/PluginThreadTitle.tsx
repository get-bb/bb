import { useLayoutEffect, useRef } from "react";
import type { PluginThreadTitleProps } from "@get-bb/plugin-sdk";
import { ThreadTitleMentions } from "@/components/thread/ThreadTitleMentions";
import { useSidebarThreadEntry } from "@/lib/plugin-sidebar-hooks";
import { getThreadDisplayTitle } from "@/lib/thread-title";

export function PluginThreadTitle({ threadId }: PluginThreadTitleProps) {
  const entry = useSidebarThreadEntry(threadId);
  const title = entry === null ? "" : getThreadDisplayTitle(entry);
  const titleRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const root = titleRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const viewport = root.querySelector<HTMLElement>(
      ".bb-thread-title-content",
    );
    const text = root.querySelector<HTMLElement>(".bb-thread-title-text");
    if (!viewport || !text) return;
    const row = root.closest<HTMLElement>(".bb-sidebar-hover-actions-row");
    const measure = () => {
      const viewportRect = viewport.getBoundingClientRect();
      const actionLeft = Array.from(
        row?.querySelectorAll<HTMLElement>(".bb-sidebar-hover-actions") ?? [],
      ).reduce((left, action) => {
        const rect = action.getBoundingClientRect();
        return rect.width > 0 ? Math.min(left, rect.left) : left;
      }, viewportRect.right);
      const actionOverlap = Math.max(0, viewportRect.right - actionLeft);
      const hoverInset = actionOverlap + (actionOverlap > 0.5 ? 8 : 0);
      const hoverWidth = Math.max(0, viewportRect.width - hoverInset);
      const textWidth = text.getBoundingClientRect().width;
      const overflow = textWidth > viewportRect.width + 0.5;
      const hoverOverflow = textWidth > hoverWidth + 0.5;
      const fadeAllowance =
        Number.parseFloat(getComputedStyle(root).fontSize) + 2;
      const distance = Math.max(
        0,
        textWidth - hoverWidth + (hoverOverflow ? fadeAllowance : 0),
      );
      root.style.setProperty("--bb-thread-title-pan-distance", `${distance}px`);
      const travelDuration = distance / 40;
      const totalDuration = 2 * travelDuration + 5;
      root.style.setProperty(
        "--bb-thread-title-pan-duration",
        `${totalDuration}s`,
      );
      root.style.setProperty(
        "--bb-thread-title-pan-hold-end",
        `${(2.5 / totalDuration) * 100}%`,
      );
      root.style.setProperty(
        "--bb-thread-title-hover-inset",
        `${hoverInset}px`,
      );
      root.dataset.threadTitleOverflow = overflow ? "true" : "false";
      root.dataset.threadTitleHoverOverflow = hoverOverflow ? "true" : "false";
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(text);
    row
      ?.querySelectorAll<HTMLElement>(".bb-sidebar-hover-actions")
      .forEach((action) => observer.observe(action));
    measure();
    return () => observer.disconnect();
  }, [title]);

  if (entry === null) return null;
  return (
    <span ref={titleRef} className="bb-thread-title bb-thread-title-pan">
      <span className="bb-thread-title-content">
        <span className="bb-thread-title-text">
          <ThreadTitleMentions title={title} />
        </span>
      </span>
    </span>
  );
}
