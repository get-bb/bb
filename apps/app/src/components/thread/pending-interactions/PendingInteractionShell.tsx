import { ThreadQuestionFormHost } from "../user-questions/ThreadQuestionFormHost";
import { useStickyFooterAvailableHeight } from "../user-questions/useStickyFooterAvailableHeight";
import {
  Activity,
  createContext,
  Fragment,
  useContext,
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

export type PendingInteractionPresentation = "card" | "inline";

export const PendingInteractionPresentationContext =
  createContext<PendingInteractionPresentation>("card");

interface PendingInteractionShellProps {
  label: string;
  title?: string;
  expandedByDefault: boolean;
  errorMessage?: string | null;
  footer?: ReactNode;
  children?: (isExpanded: boolean) => ReactNode;
  sourceThread?: PendingInteractionSourceThread;
  testId: string;
}

export function PendingInteractionShell({
  label,
  title,
  expandedByDefault,
  errorMessage,
  footer,
  children,
  sourceThread,
  testId,
}: PendingInteractionShellProps) {
  const presentation = useContext(PendingInteractionPresentationContext);
  const [isExpanded, setIsExpanded] = useState(expandedByDefault);
  const [previousExpandedByDefault, setPreviousExpandedByDefault] =
    useState(expandedByDefault);
  if (expandedByDefault !== previousExpandedByDefault) {
    setPreviousExpandedByDefault(expandedByDefault);
    if (expandedByDefault) setIsExpanded(true);
  }
  const rootRef = useRef<HTMLElement>(null);
  const availableHeight = useStickyFooterAvailableHeight(rootRef, isExpanded);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const contentId = useId();
  const errorId = useId();
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
      id={errorId}
      aria-live="polite"
      className={
        isExpanded
          ? "mx-3 mb-3 rounded-md border border-surface-destructive-border bg-surface-destructive px-2 py-1 text-xs text-destructive-text"
          : "sr-only"
      }
    >
      {errorMessage}
    </div>
  ) : null;
  if (presentation === "inline") {
    return (
      <section
        aria-label={label}
        data-testid={testId}
        data-presentation="inline"
        className="flex min-w-0 flex-col text-xs text-muted-foreground"
      >
        <ThreadQuestionFormHost density="compact">
          <div className="max-h-[40dvh] min-h-0 touch-pan-y overflow-y-auto overscroll-contain">
            {title ? (
              <h3
                title={title}
                className="min-w-0 truncate text-sm font-medium text-foreground"
              >
                {title}
              </h3>
            ) : null}
            {children ? (
              <div className={title ? "mt-1" : undefined}>{children(true)}</div>
            ) : null}
            {footer ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {footer}
              </div>
            ) : null}
          </div>
        </ThreadQuestionFormHost>
        {errorMessage ? (
          <div
            aria-live="polite"
            className="mt-1.5 rounded-md border border-surface-destructive-border bg-surface-destructive px-2 py-1 text-xs text-destructive-text"
          >
            {errorMessage}
          </div>
        ) : null}
      </section>
    );
  }
  const sourceThreadLink = sourceThread ? (
    <NavLink
      to={sourceThread.href}
      title={sourceThread.title}
      className="min-w-0 max-w-[40%] shrink-[3] truncate text-xs text-subtle-foreground no-underline hover:underline"
    >
      From {sourceThread.title}
    </NavLink>
  ) : null;

  return (
    <section
      ref={rootRef}
      aria-label={label}
      data-testid={testId}
      data-expanded={isExpanded ? "" : undefined}
      onKeyDown={handleKeyDown}
      style={
        availableHeight === null
          ? undefined
          : { maxHeight: Math.max(160, availableHeight) }
      }
      className="@container mb-2 flex min-h-0 min-w-0 max-w-full flex-col overflow-hidden rounded-lg border border-border bg-surface-recessed text-xs text-muted-foreground"
    >
      <div
        className={cn(
          "flex min-h-9 shrink-0 items-center gap-2 pl-3 pr-1.5",
          isExpanded ? "border-b border-border-hairline py-1.5" : "py-1",
        )}
      >
        <button
          type="button"
          aria-controls={contentId}
          aria-expanded={isExpanded}
          aria-label={label}
          aria-describedby={errorMessage ? errorId : undefined}
          onClick={handleToggle}
          className="flex min-h-7 min-w-0 flex-1 items-center rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="flex min-w-0 flex-1 items-start gap-2">
            <span className="flex h-[1lh] shrink-0 items-center text-sm">
              <AttentionDot hasError={Boolean(errorMessage)} />
            </span>
            <span
              title={label}
              className={cn(
                "min-w-0 text-sm text-foreground",
                isExpanded
                  ? "whitespace-normal font-semibold"
                  : "truncate font-medium",
              )}
            >
              <BreakableLabel label={label} />
            </span>
          </span>
        </button>
        {isExpanded ? sourceThreadLink : null}
        {toggle}
      </div>
      <Activity mode={isExpanded ? "visible" : "hidden"}>
        <ThreadQuestionFormHost density="default">
          <div
            id={contentId}
            hidden={!isExpanded}
            className="min-h-0 max-h-[min(32rem,50dvh)] touch-pan-y overflow-y-auto overscroll-contain px-3 pb-3 pt-2.5"
          >
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
                {footer}
              </div>
            ) : null}
          </div>
        </ThreadQuestionFormHost>
      </Activity>
      {errorNode}
    </section>
  );
}

function BreakableLabel({ label }: { label: string }) {
  return label.split(/([/\\])/).map((part, index) => (
    <Fragment key={index}>
      {part}
      {part === "/" || part === "\\" ? <wbr /> : null}
    </Fragment>
  ));
}

function AttentionDot({ hasError }: { hasError: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full ring-[3px]",
        hasError
          ? "bg-destructive-text ring-surface-destructive"
          : "bg-attention ring-surface-attention",
      )}
    />
  );
}
