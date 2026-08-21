import type { CSSProperties, ReactNode } from "react";

/**
 * The two-column state-catalogue shell: what a state is on the left, the real
 * component on the right, every state stacked down one scrollable page.
 *
 * Extracted from the Extensions detail stories so a second catalogue does not
 * have to reimplement the shell — and so the two cannot drift into looking
 * like different kinds of document. Keep layout here and fixtures in the
 * story file; this module knows nothing about any particular component.
 */
export function StoryStates({
  title,
  description,
  renderedLabel = "Rendered page",
  renderedNote = "The real component",
  children,
}: {
  title: string;
  description: string;
  renderedLabel?: string;
  renderedNote?: string;
  children: ReactNode;
}) {
  return (
    <main
      className="mx-auto w-full max-w-[72rem] space-y-4 px-5 py-6"
      style={{ "--story-doc-width": "232px" } as CSSProperties}
    >
      <header>
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {description}
        </p>
      </header>
      <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
        <div className="grid grid-cols-[var(--story-doc-width)_minmax(0,1fr)] max-[900px]:hidden">
          <span className="flex flex-col border-r border-border bg-surface-recessed px-4 py-2">
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              State
            </span>
            <span className="text-2xs text-subtle-foreground">
              When it happens
            </span>
          </span>
          <span className="flex flex-col px-4 py-2">
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              {renderedLabel}
            </span>
            <span className="text-2xs text-subtle-foreground">
              {renderedNote}
            </span>
          </span>
        </div>
        {children}
      </div>
    </main>
  );
}

/**
 * One state: what it is on the left, the real page on the right. The caption
 * sticks while a tall page scrolls past it, so you never lose track of which
 * state you are looking at.
 */
export function StoryState({
  name,
  note,
  children,
}: {
  name: string;
  /** A sentence, or a list when the state has several ways in. */
  note: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid grid-cols-[var(--story-doc-width)_minmax(0,1fr)] items-start max-[900px]:grid-cols-1">
      <div className="h-full border-r border-border bg-surface-recessed max-[900px]:border-b max-[900px]:border-r-0">
        <div className="sticky top-0 px-4 py-4">
          <h2 className="text-sm font-medium text-foreground">{name}</h2>
          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {note}
          </div>
        </div>
      </div>
      <div className="min-w-0 px-5 py-5">{children}</div>
    </section>
  );
}

/**
 * A band across both columns that names the group of states beneath it, so a
 * long catalogue reads as sections rather than one undifferentiated list.
 */
export function StoryStateGroup({
  title,
  note,
}: {
  title: string;
  note?: string;
}) {
  return (
    <div className="border-b border-border bg-surface-recessed px-5 py-2.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">
        {title}
      </h2>
      {note ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
      ) : null}
    </div>
  );
}
