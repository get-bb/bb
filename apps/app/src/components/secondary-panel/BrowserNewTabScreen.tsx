import { useState, type FormEvent } from "react";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";
import { getBrowserUrlHost } from "@/lib/browser-url";
import type { BrowserHistoryEntry } from "@/lib/browser-history";

interface BrowserQuickLink {
  label: string;
  url: string;
}

interface BrowserNewTabScreenProps {
  onNavigateInput: (rawInput: string) => void;
  recent: readonly BrowserHistoryEntry[];
  onClearRecent: () => void;
}

interface BrowserLetterTileProps {
  label: string;
  className?: string;
}

// A small fixed set of starting points for v1. A user-editable quick-links
// manager is a later phase (per the plan); these stay a static stub.
const BROWSER_QUICK_LINKS: readonly BrowserQuickLink[] = [
  { label: "Google", url: "https://www.google.com" },
  { label: "GitHub", url: "https://github.com" },
  { label: "Claude", url: "https://claude.ai" },
  { label: "Hacker News", url: "https://news.ycombinator.com" },
  { label: "MDN", url: "https://developer.mozilla.org" },
  { label: "npm", url: "https://www.npmjs.com" },
];

const SECTION_LABEL_CLASS =
  "mb-2 px-1 text-xs font-medium uppercase tracking-wider text-subtle-foreground";

function formatVisitedAgo(visitedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - visitedAt) / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

// A neutral first-letter tile for quick links. Remote favicons are intentionally
// not fetched/rendered here (untrusted source); recently-visited rows use a
// generic globe icon instead.
function BrowserLetterTile({ label, className }: BrowserLetterTileProps) {
  return (
    <span
      className={cn(
        "flex items-center justify-center text-xs font-semibold text-muted-foreground",
        className,
      )}
      aria-hidden
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function BrowserNewTabScreen({
  onNavigateInput,
  recent,
  onClearRecent,
}: BrowserNewTabScreenProps) {
  const [query, setQuery] = useState("");
  const now = Date.now();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return;
    }
    onNavigateInput(trimmed);
    setQuery("");
  };

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto px-6 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex flex-col items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-card text-ring">
            <Icon name="Globe" className="size-6" aria-hidden />
          </span>
          <div className="text-center">
            <div className="text-base font-semibold">New tab</div>
            <div className="text-xs text-muted-foreground">
              Search the web, or jump back in
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="relative">
          <Icon
            name="Search"
            className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the web or type a URL"
            aria-label="Search the web or type a URL"
            autoComplete="off"
            spellCheck={false}
            className="h-12 w-full rounded-xl border border-border bg-card pl-11 pr-4 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </form>
        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1">
            <span className="size-1.5 rounded-full bg-success" />
            Isolated session
          </span>
          <span aria-hidden>·</span>
          <span>Searches go to your default engine</span>
        </div>

        <section className="mt-8">
          <div className={SECTION_LABEL_CLASS}>Quick links</div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {BROWSER_QUICK_LINKS.map((link) => (
              <button
                key={link.url}
                type="button"
                onClick={() => onNavigateInput(link.url)}
                title={link.label}
                className="group flex flex-col items-center gap-2 rounded-lg border border-transparent px-1.5 py-3 transition-colors hover:border-border hover:bg-card focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <span className="flex size-11 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm">
                  <BrowserLetterTile label={link.label} className="size-11" />
                </span>
                <span className="max-w-full truncate text-xs text-muted-foreground group-hover:text-foreground">
                  {link.label}
                </span>
              </button>
            ))}
          </div>
        </section>

        {recent.length > 0 ? (
          <section className="mt-8">
            <div className="mb-2 flex items-center px-1">
              <span className="text-xs font-medium uppercase tracking-wider text-subtle-foreground">
                Recently visited
              </span>
              <button
                type="button"
                onClick={onClearRecent}
                className="ml-auto text-xs text-link transition-colors hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                Clear
              </button>
            </div>
            <div className="flex flex-col gap-px">
              {recent.map((entry) => (
                <button
                  key={entry.url}
                  type="button"
                  onClick={() => onNavigateInput(entry.url)}
                  title={entry.url}
                  className="flex items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-surface-raised">
                    <Icon
                      name="Globe"
                      className="size-3.5 text-muted-foreground"
                      aria-hidden
                    />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-xs text-foreground">
                      {entry.title ?? getBrowserUrlHost(entry.url)}
                    </span>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {getBrowserUrlHost(entry.url)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatVisitedAgo(entry.visitedAt, now)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
