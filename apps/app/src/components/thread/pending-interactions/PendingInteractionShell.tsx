import {
  Activity,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { NavLink } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { ExpandableLine } from "@/components/ui/expandable-line.js";

export interface PendingInteractionSourceThread {
  href: string;
  title: string;
}

interface PendingInteractionShellProps {
  label: string;
  title?: string;
  summary?: string | null;
  initiallyExpanded: boolean;
  errorMessage?: string | null;
  footer?: (layout: PendingInteractionLayout) => ReactNode;
  children?: (isExpanded: boolean) => ReactNode;
  sourceThread?: PendingInteractionSourceThread;
  testId: string;
}

export type PendingInteractionLayout = "strip" | "card";

export function PendingInteractionShell({
  label,
  title,
  summary,
  initiallyExpanded,
  errorMessage,
  footer,
  children,
  sourceThread,
  testId,
}: PendingInteractionShellProps) {
  const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreToggleFocusRef = useRef(false);
  const contentId = useId();
  useLayoutEffect(() => {
    if (!shouldRestoreToggleFocusRef.current) return;
    shouldRestoreToggleFocusRef.current = false;
    toggleRef.current?.focus();
  }, [isExpanded]);
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && isExpanded && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      shouldRestoreToggleFocusRef.current = true;
      setIsExpanded(false);
    }
  };
  const toggle = (
    <button
      ref={toggleRef}
      type="button"
      aria-controls={contentId}
      aria-expanded={isExpanded}
      aria-label={isExpanded ? "Hide details" : "Show details"}
      onClick={(event) => {
        shouldRestoreToggleFocusRef.current =
          document.activeElement === event.currentTarget;
        setIsExpanded((value) => !value);
      }}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Icon
        name="ChevronDown"
        className={cn(
          "size-3.5 transition-transform duration-200",
          isExpanded ? "rotate-180" : undefined,
        )}
      />
    </button>
  );
  const errorNode = errorMessage ? (
    <div
      aria-live="polite"
      className="mx-3 mb-3 rounded-md border border-surface-destructive-border bg-surface-destructive px-2 py-1 text-xs text-destructive-text"
    >
      {errorMessage}
    </div>
  ) : null;
  const sourceThreadLink = sourceThread ? (
    <NavLink
      to={sourceThread.href}
      title={sourceThread.title}
      className="min-w-24 shrink-[3] truncate text-xs text-subtle-foreground no-underline hover:underline"
    >
      From {sourceThread.title}
    </NavLink>
  ) : null;

  return (
    <section
      aria-label={label}
      data-testid={testId}
      data-expanded={isExpanded ? "" : undefined}
      onKeyDown={handleKeyDown}
      className="@container mb-2 min-w-0 max-w-full rounded-lg border border-border bg-surface-recessed text-xs text-muted-foreground"
    >
      {isExpanded ? (
        <div className="flex items-center gap-2 border-b border-border-hairline py-1.5 pl-3 pr-1.5">
          <AttentionDot />
          <span className="min-w-0 truncate text-sm font-semibold text-foreground">
            {label}
          </span>
          {sourceThreadLink}
          <span className="flex-1" />
          {toggle}
        </div>
      ) : (
        <div className="flex min-h-9 items-center gap-2 py-1 pl-3 pr-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <AttentionDot />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span
                className="min-w-0 truncate text-sm font-medium text-foreground @2xl:shrink"
                title={title ?? label}
              >
                {title ?? label}
              </span>
              {summary ? (
                <span
                  className="hidden min-w-0 truncate font-mono text-xs text-muted-foreground @2xl:block @2xl:shrink-[2]"
                  title={summary}
                >
                  {summary}
                </span>
              ) : null}
              <div className="hidden min-w-0 @2xl:contents">
                {sourceThreadLink}
              </div>
            </div>
          </div>
          <div className="order-2 shrink-0 @2xl:order-3">{toggle}</div>
          {footer ? (
            <div className="order-2 hidden shrink-0 items-center gap-1.5 @2xl:flex">
              {footer("strip")}
            </div>
          ) : null}
        </div>
      )}
      <Activity mode={isExpanded ? "visible" : "hidden"}>
        <div id={contentId} hidden={!isExpanded} className="px-3 pb-3 pt-2.5">
          {title ? (
            <h3 className="min-w-0 text-sm font-medium text-foreground">
              <ExpandableLine
                fullText={title}
                collapsedClassName="line-clamp-2"
              >
                {title}
              </ExpandableLine>
            </h3>
          ) : null}
          {children ? (
            <div className={title ? "mt-2" : undefined}>
              {children(isExpanded)}
            </div>
          ) : null}
          {footer ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {footer("card")}
            </div>
          ) : null}
        </div>
      </Activity>
      {errorNode}
    </section>
  );
}

function AttentionDot() {
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full bg-attention ring-[3px] ring-surface-attention"
    />
  );
}
