import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";

export function ExpandableText({
  children,
  className,
  expandLabel = "Show more",
}: {
  children: ReactNode;
  className?: string;
  expandLabel?: string;
}) {
  const id = useId();
  const textRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element || expanded) return;
    const measure = () =>
      setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [children, expanded]);

  return (
    <span className={cn("block min-w-0", className)}>
      <span
        ref={textRef}
        id={id}
        className={cn(
          "break-words [overflow-wrap:anywhere]",
          expanded ? "block" : "line-clamp-3",
        )}
      >
        {children}
      </span>
      {expanded || overflowing ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          className="pointer-events-auto mt-1 cursor-pointer rounded-sm text-xs font-medium underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
        >
          {expanded ? "Show less" : expandLabel}
        </button>
      ) : null}
    </span>
  );
}
