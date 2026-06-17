import { useLayoutEffect, useState, type RefObject } from "react";
import { cn } from "@/lib/utils";

interface UseOverflowMeasurementArgs {
  elementRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  measurementKey: string;
}

type OverflowMeasurement = "unmeasured" | "fits" | "overflowing";

interface ConversationMessageOverflowToggleLabels {
  collapsed: string;
  expanded: string;
}

interface ConversationMessageOverflowToggleProps {
  expanded: boolean;
  labels: ConversationMessageOverflowToggleLabels;
  onToggle: () => void;
}

interface ConversationMessageInlineOverflowToggleProps {
  buttonBackgroundClassName: string;
  fadeFromClassName: string;
  label: string;
  onToggle: () => void;
}

export function useOverflowMeasurement({
  elementRef,
  enabled,
  measurementKey,
}: UseOverflowMeasurementArgs): OverflowMeasurement {
  const [measurement, setMeasurement] =
    useState<OverflowMeasurement>("unmeasured");

  // useLayoutEffect (not useEffect) so the first measurement runs before
  // paint. Otherwise the first paint renders without the overflow toggle,
  // and the button appears on the next frame after the effect runs.
  useLayoutEffect(() => {
    if (!enabled) {
      setMeasurement("fits");
      return;
    }

    const element = elementRef.current;
    if (!element) {
      setMeasurement("unmeasured");
      return;
    }

    const measure = () => {
      // ResizeObserver still fires after the observed node detaches (e.g. when
      // an expandable row swaps the collapsed preview for the expanded body).
      // A detached node reports scroll/client size 0, which would flip the
      // measurement to "fits" and unexpand the row mid-click. Treat detached
      // nodes as "no new information" — the last connected measurement stands.
      if (!element.isConnected) return;
      setMeasurement(
        element.scrollHeight > element.clientHeight + 1 ||
          element.scrollWidth > element.clientWidth + 1
          ? "overflowing"
          : "fits",
      );
    };
    measure();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [elementRef, enabled, measurementKey]);

  return measurement;
}

export function useIsOverflowing(args: UseOverflowMeasurementArgs): boolean {
  return useOverflowMeasurement(args) === "overflowing";
}

export function ConversationMessageOverflowToggle({
  expanded,
  labels,
  onToggle,
}: ConversationMessageOverflowToggleProps) {
  return (
    <div className="mt-1 flex justify-end">
      <button
        type="button"
        onClick={onToggle}
        className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={expanded}
      >
        {expanded ? labels.expanded : labels.collapsed}
      </button>
    </div>
  );
}

export function ConversationMessageInlineOverflowToggle({
  buttonBackgroundClassName,
  fadeFromClassName,
  label,
  onToggle,
}: ConversationMessageInlineOverflowToggleProps) {
  return (
    <span className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[1lh] items-stretch justify-end">
      <span
        className={cn(
          "w-12 bg-gradient-to-l to-transparent",
          fadeFromClassName,
        )}
      />
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "pointer-events-auto cursor-pointer whitespace-nowrap pl-1.5 text-xs font-medium text-muted-foreground hover:text-foreground",
          buttonBackgroundClassName,
        )}
        aria-expanded={false}
      >
        {label}
      </button>
    </span>
  );
}
