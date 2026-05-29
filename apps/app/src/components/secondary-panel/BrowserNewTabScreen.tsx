import { useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon.js";
import { Input } from "@/components/ui/input.js";
import { cn } from "@/lib/utils";
import { getBrowserUrlHost } from "@/lib/browser-url";
import { formatRelativeTime } from "@/lib/relative-time";
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
}

interface BrowserRowButtonProps {
  url: string;
  onSelect: () => void;
  children: ReactNode;
}

interface BrowserQuickLinkRowProps {
  link: BrowserQuickLink;
  onNavigate: (url: string) => void;
}

interface BrowserRecentRowProps {
  entry: BrowserHistoryEntry;
  now: number;
  onNavigate: (url: string) => void;
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

// Match the secondary-panel launcher (NewTabFileSearch): uppercase section
// labels, hairline-bordered chips, and dense rows that share the app's tokens.
const SECTION_LABEL_CLASS =
  "px-1 text-xs font-medium uppercase tracking-wider text-subtle-foreground";
const ROW_BASE_CLASS =
  "group flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const ROW_CHIP_CLASS =
  "flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border-hairline bg-surface-raised text-muted-foreground";

// A neutral first-letter tile for quick links. Remote favicons are intentionally
// not fetched/rendered here (untrusted source); recently-visited rows use a
// generic globe icon instead.
function BrowserLetterTile({ label }: BrowserLetterTileProps) {
  return (
    <span className="text-xs font-semibold" aria-hidden>
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

// Shared row shell for quick-link and recently-visited rows, mirroring the
// launcher's LauncherTile so hover, focus, and density stay identical.
function BrowserRowButton({ url, onSelect, children }: BrowserRowButtonProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={url}
      className={ROW_BASE_CLASS}
    >
      {children}
    </button>
  );
}

function BrowserQuickLinkRow({ link, onNavigate }: BrowserQuickLinkRowProps) {
  return (
    <BrowserRowButton url={link.url} onSelect={() => onNavigate(link.url)}>
      <span className={ROW_CHIP_CLASS}>
        <BrowserLetterTile label={link.label} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {link.label}
      </span>
      <span className="shrink-0 truncate font-mono text-xs text-muted-foreground">
        {getBrowserUrlHost(link.url)}
      </span>
    </BrowserRowButton>
  );
}

function BrowserRecentRow({ entry, now, onNavigate }: BrowserRecentRowProps) {
  const host = getBrowserUrlHost(entry.url);
  const title = entry.title?.trim();
  const primary = title && title.length > 0 ? title : host;
  const relativeTime = formatRelativeTime({ timestamp: entry.visitedAt, now });

  return (
    <BrowserRowButton url={entry.url} onSelect={() => onNavigate(entry.url)}>
      <span className={ROW_CHIP_CLASS}>
        <Icon name="Globe" className="size-3.5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-foreground">{primary}</span>
        {primary !== host ? (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {host}
          </span>
        ) : null}
      </span>
      <span className="ml-auto flex shrink-0 items-center justify-end">
        <span className="whitespace-nowrap text-xs text-muted-foreground group-hover:hidden">
          {relativeTime}
        </span>
        <span
          className="hidden items-center gap-1 text-xs text-subtle-foreground group-hover:flex"
          aria-hidden
        >
          <Icon name="ArrowUpRight" className="size-3" aria-hidden />
          open
        </span>
      </span>
    </BrowserRowButton>
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
    <div className="flex h-full flex-col overflow-y-auto px-4 pb-6 pt-8">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <div>
          <form onSubmit={handleSubmit} className="relative">
            <Icon
              name="Search"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the web or type a URL"
              aria-label="Search the web or type a URL"
              autoComplete="off"
              spellCheck={false}
              className="pl-9"
            />
          </form>
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            Searches go to your default engine.
          </p>
        </div>

        <section>
          <div className={cn(SECTION_LABEL_CLASS, "mb-1.5")}>Quick links</div>
          <ul aria-label="Quick links" className="flex flex-col gap-px">
            {BROWSER_QUICK_LINKS.map((link) => (
              <li key={link.url}>
                <BrowserQuickLinkRow link={link} onNavigate={onNavigateInput} />
              </li>
            ))}
          </ul>
        </section>

        {recent.length > 0 ? (
          <section>
            <div
              className={cn(SECTION_LABEL_CLASS, "mb-1.5 flex items-baseline gap-2")}
            >
              <span>Recently visited</span>
              <span className="font-mono text-xs font-normal normal-case tracking-normal text-muted-foreground opacity-80">
                {recent.length}
              </span>
              <button
                type="button"
                onClick={onClearRecent}
                aria-label="Clear recently visited"
                className="ml-auto rounded text-xs font-normal normal-case tracking-normal text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                Clear
              </button>
            </div>
            <ul aria-label="Recently visited" className="flex flex-col gap-px">
              {recent.map((entry) => (
                <li key={entry.url}>
                  <BrowserRecentRow
                    entry={entry}
                    now={now}
                    onNavigate={onNavigateInput}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
