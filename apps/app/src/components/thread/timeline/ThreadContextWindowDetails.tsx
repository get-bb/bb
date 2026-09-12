import { useId, useState, type ReactNode } from "react";
import { cn } from "@bb/shared-ui/lib/utils";

import type { ContextCategory, ContextSnapshot } from "@bb/domain";

type ContextWindowDetails = Pick<ContextSnapshot, "categories">;

const CATEGORY_COLORS = [
  "var(--ansi-4)",
  "var(--ansi-1)",
  "var(--ansi-3)",
  "var(--ansi-5)",
  "var(--ansi-6)",
  "var(--ansi-2)",
  "var(--ansi-8)",
];

export function ThreadContextWindowSegments({
  details,
  modelContextWindow,
  visible,
}: {
  details: ContextWindowDetails;
  modelContextWindow: number;
  visible: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 flex transition-opacity duration-200 ease-out motion-reduce:transition-none",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      {details.categories
        .filter((category) => category.kind === "used")
        .map((category, index) => (
          <div
            key={category.id}
            className="h-full shrink-0"
            style={{
              width: `${(category.tokens / modelContextWindow) * 100}%`,
              backgroundColor: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
            }}
          />
        ))}
    </div>
  );
}

export function ContextWindowReveal({
  open,
  id,
  children,
}: {
  open: boolean;
  id: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function CategoryRow({
  category,
  color,
  capacity,
}: {
  category: ContextCategory;
  color: string;
  capacity: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const hasItems = category.entries.length > 0;
  const inWindow = category.kind !== "deferred";
  const label = inWindow
    ? category.label
    : category.label.replace(/\s*\(deferred\)$/i, "");
  const summary = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "size-3 shrink-0 rounded-[3px]",
          category.kind === "free" || category.kind === "reserved"
            ? "border border-border"
            : null,
        )}
        style={{
          backgroundColor: category.kind === "used" ? color : "var(--border)",
        }}
      />
      <span className="min-w-0 flex-1 text-left">{label}</span>
      <span className="flex shrink-0 items-baseline gap-2 tabular-nums @max-[20rem]/context-window:flex-col @max-[20rem]/context-window:items-end @max-[20rem]/context-window:gap-0">
        <span>{category.tokens.toLocaleString("en-US")}</span>
        {inWindow ? (
          <span className="w-12 text-right text-xs text-muted-foreground">
            {((category.tokens / capacity) * 100).toFixed(1)}%
          </span>
        ) : null}
      </span>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        aria-hidden="true"
        data-icon-root=""
        className={cn(
          "size-3 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none",
          expanded && "rotate-90",
          !hasItems && "invisible",
        )}
      >
        <path d="m6 4 4 4-4 4" />
      </svg>
    </>
  );
  const summaryClassName = cn(
    "flex w-full items-center gap-2 py-1.5 text-xs max-md:text-sm",
    category.kind === "used" ? "text-foreground" : "text-muted-foreground",
  );

  return (
    <div>
      {hasItems ? (
        <button
          type="button"
          className={cn(
            summaryClassName,
            "cursor-pointer rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
        >
          {summary}
        </button>
      ) : (
        <div className={summaryClassName}>{summary}</div>
      )}
      {hasItems ? (
        <ContextWindowReveal id={contentId} open={expanded}>
          <div
            className={cn(
              "space-y-1 pb-2 pl-5 pr-5 text-xs text-muted-foreground max-md:text-sm",
              inWindow && "pr-[4.75rem] @max-[20rem]/context-window:pr-5",
            )}
          >
            {category.entries.map((item) => (
              <div key={item.id} className="flex items-baseline gap-3">
                <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
                  {item.label}
                </span>
                <span className="shrink-0 tabular-nums">
                  {item.tokens.toLocaleString("en-US")}
                </span>
              </div>
            ))}
          </div>
        </ContextWindowReveal>
      ) : null}
    </div>
  );
}

export function ThreadContextWindowDetails({
  details,
  capacity,
}: {
  details: ContextWindowDetails;
  capacity: number;
}) {
  const used = details.categories.filter(
    (category) => category.kind === "used",
  );
  const remaining = details.categories.filter(
    (category) => category.kind === "free" || category.kind === "reserved",
  );
  const deferred = details.categories.filter(
    (category) => category.kind === "deferred",
  );

  return (
    <div className="mt-2">
      <div className="mx-2 border-t border-border-hairline max-md:mx-4" />
      <div className="max-h-[min(32rem,55dvh)] overflow-y-auto overscroll-contain">
        <div className="px-2 pt-2 max-md:px-4">
          <h3 className="pb-1 text-xs font-medium text-muted-foreground">
            In context
          </h3>
          {used.map((category, index) => (
            <CategoryRow
              key={category.id}
              category={category}
              capacity={capacity}
              color={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
            />
          ))}
          {remaining.length > 0 ? (
            <div className="mt-1 border-t border-border-hairline pt-1">
              {remaining.map((category) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  capacity={capacity}
                  color="var(--muted-foreground)"
                />
              ))}
            </div>
          ) : null}
          {deferred.length > 0 ? (
            <section className="mt-2 border-t border-border-hairline pt-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                Available on demand
              </h3>
              <p className="mt-1 mb-1 text-xs text-muted-foreground">
                Loaded when needed. Excluded from current usage.
              </p>
              {deferred.map((category) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  capacity={capacity}
                  color="var(--muted-foreground)"
                />
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
