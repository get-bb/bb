import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface SuggestionCardProps {
  leading: ReactNode;
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  compact?: boolean;
  grouped?: boolean;
  onSelect?: () => void;
  ariaLabel?: string;
}

export const SUGGESTION_TILE_CLASS =
  "flex size-9 shrink-0 items-center justify-center rounded-lg bg-state-hover text-muted-foreground";

export function SuggestionTile({ children }: { children: ReactNode }) {
  return <span className={SUGGESTION_TILE_CLASS}>{children}</span>;
}

export function SuggestionCard({
  leading,
  title,
  description,
  meta,
  trailing,
  selected = false,
  compact = false,
  grouped = false,
  onSelect,
  ariaLabel,
}: SuggestionCardProps) {
  return (
    <button
      type="button"
      data-suggestion-card=""
      aria-pressed={onSelect && !grouped ? selected : undefined}
      aria-label={ariaLabel}
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer gap-3 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
        compact ? "items-center px-3.5 py-3" : "items-start p-4",
        grouped
          ? "hover:bg-[color-mix(in_oklab,var(--ink)_2.5%,transparent)]"
          : "rounded-xl border bg-card hover:border-foreground/30 hover:bg-[color-mix(in_oklab,var(--ink)_2.5%,transparent)]",
        !grouped &&
          (selected
            ? "border-transparent bg-[color-mix(in_oklab,var(--timeline-accent)_6%,var(--card))] shadow-[inset_0_0_0_1.5px_var(--timeline-accent)] hover:border-transparent hover:bg-[color-mix(in_oklab,var(--timeline-accent)_6%,var(--card))]"
            : "border-border"),
      )}
    >
      {leading}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
          {title}
        </span>
        {description && !compact ? (
          <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        ) : null}
        {meta ? (
          <span className="pt-0.5 text-xs text-subtle-foreground">{meta}</span>
        ) : null}
      </span>
      {trailing ? (
        <span className="flex shrink-0 items-center self-center text-subtle-foreground">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}

export function SuggestionGroup({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border-hairline overflow-hidden rounded-xl border border-border bg-card">
      {children}
    </div>
  );
}

export function SuggestionSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-2.5">
      <p className="px-1 text-xs text-subtle-foreground">{label}</p>
      {children}
    </section>
  );
}
