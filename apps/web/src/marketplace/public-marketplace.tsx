import {
  AiContentGenerator01Icon,
  AlertCircleIcon,
  Archive03Icon,
  AudioWave01Icon,
  Cancel01Icon,
  ChartColumnIcon,
  CheckListIcon,
  Clock01Icon,
  CloudIcon,
  ComputerTerminal01Icon,
  Copy01Icon,
  Database01Icon,
  Download01Icon,
  File01Icon,
  Folder02Icon,
  FolderGitTwoIcon,
  GithubIcon,
  GitBranchIcon,
  GridViewIcon,
  Layers01Icon,
  LinkSquare01Icon,
  LockIcon,
  Mail02Icon,
  PackageIcon,
  PuzzleIcon,
  Search01Icon,
  SentIcon,
  SidebarLeftIcon,
  SlidersHorizontalIcon,
  Tick02Icon,
  UserSwitchIcon,
  WorkflowCircle03Icon,
  ZapIcon,
  ZoomInAreaIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

import { initAnalytics, trackLandingEvent } from "../landing/analytics.js";
import { SiteFooter, SiteNav } from "../landing/site-chrome.js";
import { copyPlainText } from "../lib/copy-plain-text.js";
import {
  marketplaceEntryInstalls,
  type MarketplaceStats,
} from "./marketplace-model.js";
import type {
  MarketplaceV2Entry,
  MarketplaceV2Manifest,
} from "./marketplace-v2.js";
import {
  filterMarketplaceCategories,
  filterMarketplaceEntries,
  formatInstalls,
  formatMarketplaceDate,
  marketplaceAssetUrl,
  marketplaceAuthorPath,
  marketplaceCategoryOptions,
  marketplaceDetailPath,
  marketplaceInstallCommand,
  marketplaceRepositoryUrl,
  marketplaceShelves,
  moreFromMarketplaceAuthor,
  resolveMarketplaceCategory,
  sortMarketplaceEntries,
  type MarketplaceIndexState,
  type MarketplaceShelf,
  type MarketplaceSort,
} from "./marketplace-view-model.js";

const SORT_LABELS: Record<MarketplaceSort, string> = {
  "recently-added": "Recently added",
  "most-installed": "Most installed",
};

const PLUGIN_ICONS: Readonly<Record<string, IconSvgElement | undefined>> = {
  AiContentGenerator01: AiContentGenerator01Icon,
  AlertCircle: AlertCircleIcon,
  Archive: Archive03Icon,
  AudioLines: AudioWave01Icon,
  ChartColumn: ChartColumnIcon,
  ClipboardCheck: CheckListIcon,
  Clock: Clock01Icon,
  Cloud: CloudIcon,
  Copy: Copy01Icon,
  Database: Database01Icon,
  FileText: File01Icon,
  FolderGit: FolderGitTwoIcon,
  FolderOpen: Folder02Icon,
  GitBranch: GitBranchIcon,
  GridView: GridViewIcon,
  Layers: Layers01Icon,
  Lock: LockIcon,
  Mail: Mail02Icon,
  PanelLeft: SidebarLeftIcon,
  Puzzle: PuzzleIcon,
  SlidersHorizontal: SlidersHorizontalIcon,
  SideChat: SentIcon,
  Terminal: ComputerTerminal01Icon,
  UserSwitch: UserSwitchIcon,
  Workflow: WorkflowCircle03Icon,
  Zap: ZapIcon,
  ZoomIn: ZoomInAreaIcon,
};

const MarketplaceNavigationContext = createContext<
  ((href: string) => void) | undefined
>(undefined);

export function MarketplaceNavigationProvider({
  navigate,
  children,
}: {
  navigate: (href: string) => void;
  children: ReactNode;
}) {
  return (
    <MarketplaceNavigationContext.Provider value={navigate}>
      {children}
    </MarketplaceNavigationContext.Provider>
  );
}

function MarketplaceLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const navigate = useContext(MarketplaceNavigationContext);
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        if (
          navigate === undefined ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

function PluginArtwork({
  entry,
  large = false,
}: {
  entry: MarketplaceV2Entry;
  large?: boolean;
}) {
  const className = large
    ? "marketplace-artwork is-large"
    : "marketplace-artwork";
  if (typeof entry.icon === "string") {
    return (
      <span className={className} aria-hidden>
        <HugeiconsIcon icon={PLUGIN_ICONS[entry.icon] ?? PuzzleIcon} />
      </span>
    );
  }
  return (
    <span className={className}>
      <img src={marketplaceAssetUrl(entry.icon.url)} alt="" />
    </span>
  );
}

function InstallCount({
  entry,
  stats,
}: {
  entry: MarketplaceV2Entry;
  stats: MarketplaceStats | null;
}) {
  const total = marketplaceEntryInstalls(entry, stats);
  if (total === undefined) return null;
  const formatted = formatInstalls(total) ?? total.toLocaleString("en-US");
  return (
    <span
      className="marketplace-card-installs"
      aria-label={`${total.toLocaleString("en-US")} installs`}
    >
      <HugeiconsIcon icon={Download01Icon} aria-hidden />
      {formatted}
    </span>
  );
}

function categoryLabel(
  manifest: MarketplaceV2Manifest,
  entry: MarketplaceV2Entry,
): string {
  return (
    resolveMarketplaceCategory(manifest, entry)?.displayName ?? "More plugins"
  );
}

function PluginCard({
  manifest,
  entry,
  stats,
  showCategory = false,
}: {
  manifest: MarketplaceV2Manifest;
  entry: MarketplaceV2Entry;
  stats: MarketplaceStats | null;
  showCategory?: boolean;
}) {
  return (
    <article className="marketplace-card">
      <MarketplaceLink
        className="marketplace-card-link"
        href={marketplaceDetailPath(entry.id)}
      >
        <span className="marketplace-card-topline">
          <PluginArtwork entry={entry} />
          <strong>{entry.displayName}</strong>
        </span>
        <span className="marketplace-card-description">
          {entry.description}
        </span>
        <span className="marketplace-card-meta">
          <span className="marketplace-card-author">
            By {entry.author.name}
          </span>
          <span className="marketplace-card-secondary">
            {showCategory ? (
              <span className="marketplace-category-pill">
                {categoryLabel(manifest, entry)}
              </span>
            ) : null}
            <InstallCount entry={entry} stats={stats} />
          </span>
        </span>
      </MarketplaceLink>
    </article>
  );
}

function PluginGrid({
  manifest,
  entries,
  stats,
  showCategory = false,
}: {
  manifest: MarketplaceV2Manifest;
  entries: readonly MarketplaceV2Entry[];
  stats: MarketplaceStats | null;
  showCategory?: boolean;
}) {
  return (
    <div className="marketplace-grid">
      {entries.map((entry) => (
        <PluginCard
          key={entry.id}
          manifest={manifest}
          entry={entry}
          stats={stats}
          showCategory={showCategory}
        />
      ))}
    </div>
  );
}

function Shelf({
  manifest,
  shelf,
  stats,
  onSelect,
}: {
  manifest: MarketplaceV2Manifest;
  shelf: MarketplaceShelf;
  stats: MarketplaceStats | null;
  onSelect: (category: string) => void;
}) {
  const canFilter = shelf.kind !== "collection";
  return (
    <section className="marketplace-shelf">
      <div className="marketplace-section-head">
        <div>
          <h2>{shelf.label}</h2>
          <span>{shelf.entries.length} plugins</span>
        </div>
        {canFilter ? (
          <a
            href={`/marketplace?category=${encodeURIComponent(shelf.id)}`}
            onClick={(event) => {
              event.preventDefault();
              onSelect(shelf.id);
            }}
          >
            View all
          </a>
        ) : null}
      </div>
      {shelf.description === undefined ? null : (
        <p className="marketplace-shelf-description">{shelf.description}</p>
      )}
      <PluginGrid
        manifest={manifest}
        entries={shelf.entries.slice(0, 3)}
        stats={stats}
        showCategory={shelf.kind === "collection"}
      />
    </section>
  );
}

function MarketplaceState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="marketplace-state" role="status">
      <span aria-hidden>
        <HugeiconsIcon icon={PackageIcon} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

export function PublicMarketplaceUnavailablePage() {
  return (
    <div className="wrap plugin-pages-wrap">
      <SiteNav current="plugins" />
      <main className="marketplace-main">
        <header className="plugin-page-head marketplace-page-head">
          <h1>Plugin Marketplace</h1>
          <p>Find plugins that add new features to bb.</p>
        </header>
        <MarketplaceState
          title="The Marketplace is not available"
          description="The catalog cannot load now. Try again later."
        />
      </main>
      <SiteFooter />
    </div>
  );
}

export function PublicMarketplaceNotFoundPage() {
  return (
    <div className="wrap plugin-pages-wrap">
      <SiteNav current="plugins" />
      <main className="marketplace-main">
        <MarketplaceState
          title="Page not found"
          description="The plugin or author does not exist."
        />
        <p className="marketplace-not-found-link">
          <MarketplaceLink href="/marketplace">
            Return to the Marketplace
          </MarketplaceLink>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

function MarketplaceToolbar({
  options,
  query,
  state,
  onQueryChange,
  onStateChange,
}: {
  options: readonly { id: string; label: string }[];
  query: string;
  state: MarketplaceIndexState;
  onQueryChange: (query: string) => void;
  onStateChange: (state: MarketplaceIndexState) => void;
}) {
  const activeOptions = options.filter((option) =>
    state.categories.includes(option.id),
  );
  const toggleCategory = (id: string) => {
    const categories = state.categories.includes(id)
      ? state.categories.filter((category) => category !== id)
      : [...state.categories, id];
    onStateChange({ categories, sort: state.sort });
  };
  return (
    <>
      <div className="marketplace-toolbar">
        <label className="marketplace-search">
          <span className="marketplace-visually-hidden">Search plugins</span>
          <HugeiconsIcon icon={Search01Icon} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            placeholder="Search plugins"
          />
          {query.length > 0 ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onQueryChange("")}
            >
              <HugeiconsIcon icon={Cancel01Icon} aria-hidden />
            </button>
          ) : null}
        </label>
        <label className="marketplace-select">
          <span className="marketplace-visually-hidden">Sort plugins</span>
          <select
            value={state.sort ?? ""}
            onChange={(event) => {
              const value = event.currentTarget.value;
              onStateChange({
                categories: state.categories,
                sort:
                  value === "recently-added" || value === "most-installed"
                    ? value
                    : undefined,
              });
            }}
          >
            <option value="">Featured</option>
            <option value="recently-added">Recently added</option>
            <option value="most-installed">Most installed</option>
          </select>
        </label>
      </div>
      <div className="marketplace-category-filters" aria-label="Categories">
        <span>
          <HugeiconsIcon icon={SlidersHorizontalIcon} aria-hidden />
          Categories
        </span>
        <div>
          {options.map((option) => {
            const selected = state.categories.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                className={selected ? "is-selected" : undefined}
                aria-pressed={selected}
                onClick={() => toggleCategory(option.id)}
              >
                {option.label}
              </button>
            );
          })}
          {activeOptions.length > 0 ? (
            <button
              type="button"
              className="marketplace-clear-filters"
              onClick={() =>
                onStateChange({ categories: [], sort: state.sort })
              }
            >
              Clear categories
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}

function MarketplaceBrowser({
  manifest,
  entries,
  stats,
  state,
  onStateChange,
  analyticsAuthor,
}: {
  manifest: MarketplaceV2Manifest;
  entries: readonly MarketplaceV2Entry[];
  stats: MarketplaceStats | null;
  state: MarketplaceIndexState;
  onStateChange: (state: MarketplaceIndexState) => void;
  analyticsAuthor?: string;
}) {
  const [query, setQuery] = useState("");
  const options = marketplaceCategoryOptions(manifest, entries);
  const optionIds = new Set(options.map((option) => option.id));
  const activeCategories = state.categories.filter((category) =>
    optionIds.has(category),
  );
  useMarketplacePageAnalytics(
    { categories: activeCategories, sort: state.sort },
    analyticsAuthor,
  );
  const searched = filterMarketplaceEntries(manifest, entries, query);
  const filtered = filterMarketplaceCategories(
    manifest,
    searched,
    activeCategories,
  );
  const displayed =
    state.sort === undefined
      ? filtered
      : sortMarketplaceEntries(filtered, state.sort, stats);
  const isFlat =
    query.trim().length > 0 ||
    activeCategories.length > 0 ||
    state.sort !== undefined;
  return (
    <section className="marketplace-browser" aria-label="Browse plugins">
      <MarketplaceToolbar
        options={options}
        query={query}
        state={{ categories: activeCategories, sort: state.sort }}
        onQueryChange={setQuery}
        onStateChange={onStateChange}
      />
      <div className="marketplace-results" aria-live="polite">
        {displayed.length === 0 ? (
          <MarketplaceState
            title="No plugins found"
            description="Use a different search or category."
          />
        ) : isFlat ? (
          <section className="marketplace-flat-results">
            <div className="marketplace-section-head">
              <div>
                <h2>
                  {query.trim().length > 0
                    ? "Search results"
                    : state.sort === undefined
                      ? "Filtered plugins"
                      : SORT_LABELS[state.sort]}
                </h2>
                <span>{displayed.length} plugins</span>
              </div>
            </div>
            <PluginGrid
              manifest={manifest}
              entries={displayed}
              stats={stats}
              showCategory
            />
          </section>
        ) : (
          marketplaceShelves(manifest, entries).map((shelf) => (
            <Shelf
              key={`${shelf.kind}:${shelf.id}`}
              manifest={manifest}
              shelf={shelf}
              stats={stats}
              onSelect={(category) => onStateChange({ categories: [category] })}
            />
          ))
        )}
      </div>
    </section>
  );
}

function useMarketplacePageAnalytics(
  state: MarketplaceIndexState,
  author?: string,
): void {
  const categories = state.categories.join(",");
  useEffect(() => {
    initAnalytics();
    trackLandingEvent({
      name: "marketplace_page_viewed",
      properties: {
        categories: state.categories,
        sort: state.sort ?? "featured",
        ...(author === undefined ? {} : { author }),
      },
    });
  }, [author, categories, state.sort]);
}

export function PublicMarketplacePage({
  manifest,
  stats,
  state,
  onStateChange,
}: {
  manifest: MarketplaceV2Manifest;
  stats: MarketplaceStats | null;
  state: MarketplaceIndexState;
  onStateChange: (state: MarketplaceIndexState) => void;
}) {
  return (
    <div className="wrap plugin-pages-wrap">
      <SiteNav current="plugins" />
      <main className="marketplace-main">
        <header className="plugin-page-head marketplace-page-head">
          <h1>Plugin Marketplace</h1>
          <p>Find plugins from bb and its community.</p>
        </header>
        <MarketplaceBrowser
          manifest={manifest}
          entries={manifest.plugins}
          stats={stats}
          state={state}
          onStateChange={onStateChange}
        />
      </main>
      <SiteFooter />
    </div>
  );
}

function InstallCommand({ entry }: { entry: MarketplaceV2Entry }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const command = marketplaceInstallCommand(entry.id);
  const copy = async () => {
    const copied = await copyPlainText(command);
    setStatus(copied ? "copied" : "failed");
    if (copied) {
      trackLandingEvent({
        name: "marketplace_install_command_copied",
        properties: { plugin_id: entry.id },
      });
    }
  };
  return (
    <div className="marketplace-install-command">
      <span>Install this plugin</span>
      <div>
        <code>{command}</code>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={`Copy ${command}`}
        >
          <HugeiconsIcon
            icon={status === "copied" ? Tick02Icon : Copy01Icon}
            aria-hidden
          />
          {status === "copied"
            ? "Copied"
            : status === "failed"
              ? "Copy failed"
              : "Copy"}
        </button>
      </div>
      <MarketplaceLink
        className="btn btn-ghost marketplace-get-bb"
        href="/download/macos"
      >
        Get bb
      </MarketplaceLink>
    </div>
  );
}

function MoreFromAuthor({
  manifest,
  entry,
  stats,
}: {
  manifest: MarketplaceV2Manifest;
  entry: MarketplaceV2Entry;
  stats: MarketplaceStats | null;
}) {
  const entries = moreFromMarketplaceAuthor(manifest, entry);
  if (entries.length === 0) return null;
  return (
    <section className="marketplace-detail-section">
      <h2>More from {entry.author.name}</h2>
      <div className="marketplace-author-teasers">
        {entries.map((candidate) => (
          <MarketplaceLink
            key={candidate.id}
            href={marketplaceDetailPath(candidate.id)}
          >
            <PluginArtwork entry={candidate} />
            <span>
              <strong>{candidate.displayName}</strong>
              <small>{candidate.description}</small>
            </span>
            <InstallCount entry={candidate} stats={stats} />
          </MarketplaceLink>
        ))}
      </div>
    </section>
  );
}

export function PublicMarketplaceDetailPage({
  manifest,
  entry,
  stats,
}: {
  manifest: MarketplaceV2Manifest;
  entry: MarketplaceV2Entry;
  stats: MarketplaceStats | null;
}) {
  useEffect(() => {
    initAnalytics();
    trackLandingEvent({
      name: "marketplace_plugin_detail_viewed",
      properties: { plugin_id: entry.id },
    });
  }, [entry.id]);
  const category = categoryLabel(manifest, entry);
  const installs = marketplaceEntryInstalls(entry, stats);
  const published = formatMarketplaceDate(entry.publishedAt);
  const repository = marketplaceRepositoryUrl(entry);
  const authorPath =
    entry.author.github === undefined
      ? undefined
      : marketplaceAuthorPath(entry.author.github);
  return (
    <div className="wrap plugin-pages-wrap">
      <SiteNav current="plugins" />
      <main className="marketplace-detail-main">
        <MarketplaceLink className="marketplace-back-link" href="/marketplace">
          Marketplace
        </MarketplaceLink>
        <div className="marketplace-detail-layout">
          <article className="marketplace-detail-content">
            <header className="marketplace-detail-head">
              <PluginArtwork entry={entry} large />
              <div>
                <span className="marketplace-category-pill">{category}</span>
                <h1>{entry.displayName}</h1>
                <p>
                  By{" "}
                  {authorPath === undefined ? (
                    entry.author.name
                  ) : (
                    <MarketplaceLink href={authorPath}>
                      {entry.author.name}
                      <HugeiconsIcon icon={GithubIcon} aria-hidden />
                    </MarketplaceLink>
                  )}
                </p>
              </div>
            </header>
            <p className="marketplace-detail-description">
              {entry.description}
            </p>
          </article>
          <aside className="marketplace-detail-aside">
            <InstallCommand entry={entry} />
            <dl>
              <div>
                <dt>Category</dt>
                <dd>{category}</dd>
              </div>
              {installs === undefined ? null : (
                <div>
                  <dt>Installs</dt>
                  <dd>{installs.toLocaleString("en-US")}</dd>
                </div>
              )}
              {published === null ? null : (
                <div>
                  <dt>Listed</dt>
                  <dd>{published}</dd>
                </div>
              )}
            </dl>
            <a
              className="marketplace-source-link"
              href={repository}
              target="_blank"
              rel="noreferrer"
            >
              <HugeiconsIcon icon={LinkSquare01Icon} aria-hidden />
              View source
            </a>
          </aside>
          <div className="marketplace-detail-sections">
            {entry.screenshots.length === 0 ? null : (
              <section className="marketplace-detail-section">
                <h2>Screenshots</h2>
                <div className="marketplace-screenshots">
                  {entry.screenshots.map((screenshot, index) => (
                    <img
                      key={screenshot}
                      src={marketplaceAssetUrl(screenshot)}
                      alt={`${entry.displayName} screenshot ${index + 1}`}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                    />
                  ))}
                </div>
              </section>
            )}
            <MoreFromAuthor manifest={manifest} entry={entry} stats={stats} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

export function PublicMarketplaceAuthorPage({
  manifest,
  entries,
  stats,
  state,
  onStateChange,
}: {
  manifest: MarketplaceV2Manifest;
  entries: readonly MarketplaceV2Entry[];
  stats: MarketplaceStats | null;
  state: MarketplaceIndexState;
  onStateChange: (state: MarketplaceIndexState) => void;
}) {
  const author = entries[0]?.author;
  if (author === undefined) return null;
  return (
    <div className="wrap plugin-pages-wrap">
      <SiteNav current="plugins" />
      <main className="marketplace-main">
        <MarketplaceLink
          className="marketplace-back-link marketplace-author-back"
          href="/marketplace"
        >
          Marketplace
        </MarketplaceLink>
        <header className="plugin-page-head marketplace-author-head">
          <span>Plugin author</span>
          <h1>{author.name}</h1>
          <p>{entries.length} plugins in the Marketplace.</p>
        </header>
        <MarketplaceBrowser
          manifest={manifest}
          entries={entries}
          stats={stats}
          state={state}
          onStateChange={onStateChange}
          analyticsAuthor={author.github}
        />
      </main>
      <SiteFooter />
    </div>
  );
}

export type { MarketplaceIndexState };
