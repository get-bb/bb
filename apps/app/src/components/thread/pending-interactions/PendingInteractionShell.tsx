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
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { ExpandableLine } from "@/components/ui/expandable-line.js";

export const InlinePendingInteractionContext = createContext<{
  promptShownAbove: string;
  close: () => void;
} | null>(null);

interface PendingInteractionShellProps {
  label: string;
  title?: string;
  expandedByDefault: boolean;
  errorMessage?: string | null;
  footer?: ReactNode;
  children?: (isExpanded: boolean) => ReactNode;
  testId: string;
}

export function PendingInteractionShell({
  label,
  title,
  expandedByDefault,
  errorMessage,
  footer,
  children,
  testId,
}: PendingInteractionShellProps) {
  const inline = useContext(InlinePendingInteractionContext);
  const [isExpanded, setIsExpanded] = useState(expandedByDefault);
  const [previousExpandedByDefault, setPreviousExpandedByDefault] =
    useState(expandedByDefault);
  if (expandedByDefault !== previousExpandedByDefault) {
    setPreviousExpandedByDefault(expandedByDefault);
    if (expandedByDefault) setIsExpanded(true);
  }
  const rootRef = useRef<HTMLElement>(null);
  const availableHeight = useStickyFooterAvailableHeight(
    rootRef,
    inline !== null || isExpanded,
  );
  const fittedHeightStyle =
    availableHeight === null
      ? undefined
      : { maxHeight: Math.max(160, availableHeight) };
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
        inline || isExpanded
          ? cn(
              "rounded-md border border-surface-destructive-border bg-surface-destructive px-2 py-1 text-xs text-destructive-text",
              inline ? "mt-1.5" : "mx-3 mb-3",
            )
          : "sr-only"
      }
    >
      {errorMessage}
    </div>
  ) : null;
  if (inline) {
    const inlineTitle = title === inline.promptShownAbove ? undefined : title;
    return (
      <section
        ref={rootRef}
        aria-label={label}
        data-testid={testId}
        data-presentation="inline"
        style={fittedHeightStyle}
        className="flex min-h-0 min-w-0 flex-col text-xs text-muted-foreground"
      >
        <ThreadQuestionFormHost
          density="compact"
          promptShownAbove={inline.promptShownAbove}
          closeInline={inline.close}
        >
          <div className="-m-1 max-h-[40dvh] min-h-0 touch-pan-y overflow-y-auto overscroll-contain p-1">
            {inlineTitle ? (
              <h3
                title={inlineTitle}
                className="min-w-0 truncate text-xs font-medium text-foreground"
              >
                {inlineTitle}
              </h3>
            ) : null}
            {children ? (
              <div className={inlineTitle ? "mt-1" : undefined}>
                {children(true)}
              </div>
            ) : null}
            {footer ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {footer}
              </div>
            ) : null}
          </div>
        </ThreadQuestionFormHost>
        {errorNode}
      </section>
    );
  }
  return (
    <section
      ref={rootRef}
      aria-label={label}
      data-testid={testId}
      data-expanded={isExpanded ? "" : undefined}
      onKeyDown={handleKeyDown}
      style={fittedHeightStyle}
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
            <span className="flex h-[1lh] shrink-0 items-center text-xs">
              <AttentionDot hasError={Boolean(errorMessage)} />
            </span>
            <span
              title={label}
              className={cn(
                "min-w-0 text-xs font-medium text-foreground",
                isExpanded ? "whitespace-normal" : "truncate",
              )}
            >
              <BreakableLabel label={label} />
            </span>
          </span>
        </button>
        {toggle}
      </div>
      <Activity mode={isExpanded ? "visible" : "hidden"}>
        <ThreadQuestionFormHost
          density="default"
          promptShownAbove={null}
          closeInline={null}
        >
          <div
            id={contentId}
            hidden={!isExpanded}
            className="min-h-0 max-h-[min(32rem,50dvh)] touch-pan-y overflow-y-auto overscroll-contain px-3 pb-3 pt-2.5"
          >
            {title ? (
              <h3 className="min-w-0 text-xs font-medium text-foreground">
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
