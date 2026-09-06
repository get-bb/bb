import {
  Activity,
  useId,
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
  const contentId = useId();
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && isExpanded && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      setIsExpanded(false);
      toggleRef.current?.focus();
    }
  };
  const handleToggle = () => setIsExpanded((value) => !value);
  const toggle = (
    <button
      ref={toggleRef}
      type="button"
      aria-controls={contentId}
      aria-expanded={isExpanded}
      aria-label={isExpanded ? "Hide details" : "Show details"}
      onClick={handleToggle}
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
      <div
        className={cn(
          "flex min-h-9 items-center gap-2 pl-3 pr-1.5",
          isExpanded ? "border-b border-border-hairline py-1.5" : "py-1",
        )}
      >
        <button
          type="button"
          aria-controls={contentId}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? label : (title ?? label)}
          onClick={handleToggle}
          className="flex min-h-7 min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <AttentionDot />
          <span
            title={isExpanded ? label : (title ?? label)}
            className={cn(
              "min-w-0 truncate text-sm text-foreground",
              isExpanded ? "font-semibold" : "font-medium",
            )}
          >
            {isExpanded ? label : (title ?? label)}
          </span>
          {!isExpanded && summary ? (
            <span
              className="hidden min-w-0 shrink-[2] truncate font-mono text-xs text-muted-foreground @2xl:block"
              title={summary}
            >
              {summary}
            </span>
          ) : null}
        </button>
        <div className={isExpanded ? "contents" : "hidden @2xl:contents"}>
          {sourceThreadLink}
        </div>
        {!isExpanded && footer ? (
          <div className="hidden shrink-0 items-center gap-1.5 @2xl:flex">
            {footer("strip")}
          </div>
        ) : null}
        {toggle}
      </div>
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
