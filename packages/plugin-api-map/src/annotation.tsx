import { Fragment, type ReactNode } from "react";

import { cn } from "./cn";

/**
 * The numbered annotation chip. Shared by the surface-fixture markers and anything
 * that lists surfaces, so the two can never drift apart: same size, same
 * fill, same idle/selected tokens.
 *
 * Idle chips sit on a light ink/canvas mix — a step darker than --muted, so
 * they hold their own against the mockups' own grey bones — with full
 * foreground digits at semibold weight for legibility at this size. Mixed from the two anchors, so a
 * re-anchored palette (Nord, Dracula) tints them instead of stranding grey.
 * The selected chip switches to the timeline file accent — the same color bb
 * uses for file names in thread timelines — so "selected" borrows an accent
 * the product already owns instead of inventing one.
 */
export function annotationChipClass(active: boolean, className?: string) {
  return cn(
    // size-5 around a text-xs digit at semibold weight: the circle stays a
    // marker beside the mockups' own chrome rather than a badge competing
    // with it, and the heavier digit carries the smaller ring.
    "flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold leading-none transition-colors",
    active
      ? "bg-file-accent text-background"
      : "bg-[color-mix(in_oklch,var(--ink)_18%,var(--canvas))] text-foreground",
    className,
  );
}

export function ExperimentalBadge() {
  return (
    <span
      className="inline-flex items-center rounded border border-warning/40 bg-warning/10 px-1.5 py-px font-mono text-xs text-warning-text"
      title="Experimental: audited before stabilizing — see docs/api_to_audit.md in the bb repository."
    >
      experimental
    </span>
  );
}

/** How a card should present a reference to another surface. */
export interface SurfaceReference {
  /** Marker number on its own slide, or null for a slide with no diagram. */
  number: number | null;
  /** The slide's title, when it is not the slide being read; null when it is. */
  otherPage: string | null;
  /** Pans to that surface and opens its card. */
  onOpen: () => void;
}

/**
 * Splits authored copy into plain text, `backtick` code,
 * `[label](surface-id)` cross-references, and the `{experimental}` chip that
 * marks a named API as not yet stable.
 *
 * The copy is authored prose, not markdown — these three are the only markup
 * it uses, so a tiny hand-rolled split beats pulling in a parser.
 */
const COPY_TOKEN = /(`[^`]+`)|(\[[^\]]+\]\([a-z0-9-]+\))|(\{experimental\})/g;

/**
 * Renders authored surface copy.
 *
 * With `resolve`, a `[label](surface-id)` reference becomes the label plus a
 * superscript pointing at where that surface lives: its marker number when it
 * is on the slide being read, or its number and page name when it is not, so
 * a reader can follow the reference without hunting for it. Without `resolve`
 * — or for an id the resolver does not know — the label renders as plain
 * prose, which is what any non-map consumer wants.
 */
export function renderSurfaceCopy(
  text: string,
  resolve?: (id: string) => SurfaceReference | null,
): ReactNode {
  const parts = text.split(COPY_TOKEN).filter((part) => part !== undefined);
  if (parts.length < 2) {
    return text;
  }
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={index}
          className="rounded bg-surface-recessed px-1 py-px font-mono text-[0.85em]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part === "{experimental}") {
      return (
        <Fragment key={index}>
          {" "}
          <ExperimentalBadge />
        </Fragment>
      );
    }
    const reference = /^\[([^\]]+)\]\(([a-z0-9-]+)\)$/.exec(part);
    if (!reference) {
      return <Fragment key={index}>{part}</Fragment>;
    }
    const [, label, id] = reference;
    const target = resolve?.(id) ?? null;
    if (!target) {
      return <Fragment key={index}>{label}</Fragment>;
    }
    // A link and nothing else: the words carry it, no marker or page name in
    // the running text. The page it lands on is still announced, and shown
    // on hover when it is not the page being read.
    return (
      <button
        key={index}
        type="button"
        onClick={target.onOpen}
        title={target.otherPage ? `On ${target.otherPage}` : undefined}
        aria-label={
          target.otherPage
            ? `Go to ${label} on ${target.otherPage}`
            : `Go to ${label} on this page`
        }
        className="cursor-pointer underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground"
      >
        {label}
      </button>
    );
  });
}
