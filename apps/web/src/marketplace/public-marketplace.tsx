import AiContentGenerator01Icon from "@hugeicons/core-free-icons/AiContentGenerator01Icon";
import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon";
import Archive03Icon from "@hugeicons/core-free-icons/Archive03Icon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import LinkSquare02Icon from "@hugeicons/core-free-icons/LinkSquare02Icon";
import AudioWave01Icon from "@hugeicons/core-free-icons/AudioWave01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import ChartColumnIcon from "@hugeicons/core-free-icons/ChartColumnIcon";
import CheckListIcon from "@hugeicons/core-free-icons/CheckListIcon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import CloudIcon from "@hugeicons/core-free-icons/CloudIcon";
import ComputerTerminal01Icon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Database01Icon from "@hugeicons/core-free-icons/Database01Icon";
import Download01Icon from "@hugeicons/core-free-icons/Download01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import Folder02Icon from "@hugeicons/core-free-icons/Folder02Icon";
import FolderGitTwoIcon from "@hugeicons/core-free-icons/FolderGit2Icon";
import GithubIcon from "@hugeicons/core-free-icons/GithubIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import GridViewIcon from "@hugeicons/core-free-icons/GridViewIcon";
import Layers01Icon from "@hugeicons/core-free-icons/Layers01Icon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import Mail02Icon from "@hugeicons/core-free-icons/Mail02Icon";
import PackageIcon from "@hugeicons/core-free-icons/PackageIcon";
import PuzzleIcon from "@hugeicons/core-free-icons/PuzzleIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import SentIcon from "@hugeicons/core-free-icons/SentIcon";
import SidebarLeftIcon from "@hugeicons/core-free-icons/SidebarLeftIcon";
import SlidersHorizontalIcon from "@hugeicons/core-free-icons/SlidersHorizontalIcon";
import UserSwitchIcon from "@hugeicons/core-free-icons/UserSwitchIcon";
import WorkflowCircle03Icon from "@hugeicons/core-free-icons/WorkflowCircle03Icon";
import ZapIcon from "@hugeicons/core-free-icons/ZapIcon";
import ZoomInAreaIcon from "@hugeicons/core-free-icons/ZoomInAreaIcon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { initAnalytics, trackLandingEvent } from "../landing/analytics.js";
import { CommandButton } from "../landing/command-button.js";
import { SiteFooter, SiteNav } from "../landing/site-chrome.js";
import {
  marketplaceEntryInstalls,
  type MarketplaceStats,
} from "./marketplace-model.js";
import { MarketplaceOverview } from "./marketplace-overview.js";
import type {
  MarketplaceV2Entry,
  MarketplaceV2Manifest,
} from "./marketplace-v2.js";
import {
  filterMarketplaceCategory,
  filterMarketplaceEntries,
  formatInstalls,
  marketplaceAssetUrl,
  marketplaceAuthorPath,
  marketplaceCategoryOptions,
  marketplaceDetailPath,
  marketplaceInstallCommand,
  marketplaceRepositoryUrl,
  marketplaceShelves,
  moreInMarketplaceCategory,
  moreFromMarketplaceAuthor,
  resolveMarketplaceCategory,
  sortMarketplaceEntries,
  UNCATEGORIZED_CATEGORY_ID,
  type MarketplaceCategoryOption,
  type MarketplaceIndexState,
  type MarketplaceShelf,
  type MarketplaceSort,
} from "./marketplace-view-model.js";

const SORT_LABELS: Record<MarketplaceSort, string> = {
  "recently-added": "New",
  "most-installed": "Popular",
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
  const url = marketplaceAssetUrl(entry.icon.url);
  const isSvg = new URL(url).pathname.toLowerCase().endsWith(".svg");
  return (
    <span className={className} aria-hidden>
      {isSvg ? (
        <span
          className="marketplace-svg-icon"
          style={{
            maskImage: `url(${JSON.stringify(url)})`,
            WebkitMaskImage: `url(${JSON.stringify(url)})`,
          }}
        />
      ) : (
        <img src={url} alt="" />
      )}
    </span>
  );
}

function authorInitials(name: string): string {
  return name
    .split(/\s+/u)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("");
}

function AuthorAvatar({
  author,
  large = false,
}: {
  author: MarketplaceV2Entry["author"];
  large?: boolean;
}) {
  const className = large
    ? "marketplace-author-avatar is-large"
    : "marketplace-author-avatar";
  if (author.github === undefined) {
    return (
      <span className={`${className} is-fallback`} aria-hidden>
        {authorInitials(author.name)}
      </span>
    );
  }
  return (
    <img
      className={className}
      src={`https://github.com/${encodeURIComponent(author.github)}.png?size=${large ? 64 : 32}`}
      alt=""
      referrerPolicy="no-referrer"
      loading="lazy"
    />
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
  if (total === undefined) {
    return <span className="marketplace-card-installs is-new">New</span>;
  }
  const formatted = formatInstalls(total);
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
  notable = false,
}: {
  manifest: MarketplaceV2Manifest;
  entry: MarketplaceV2Entry;
  stats: MarketplaceStats | null;
  showCategory?: boolean;
  notable?: boolean;
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
          {notable ? <span className="marketplace-new-chip">New</span> : null}
        </span>
        <span className="marketplace-card-description">
          {entry.description}
        </span>
        {showCategory ? (
          <span className="marketplace-card-category">
            {categoryLabel(manifest, entry)}
          </span>
        ) : null}
        <span className="marketplace-card-meta">
          <span className="marketplace-card-author">
            <AuthorAvatar author={entry.author} />
            <span>{entry.author.name}</span>
          </span>
          <InstallCount entry={entry} stats={stats} />
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
  notable = false,
}: {
  manifest: MarketplaceV2Manifest;
  entries: readonly MarketplaceV2Entry[];
  stats: MarketplaceStats | null;
  showCategory?: boolean;
  notable?: boolean;
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
          notable={notable}
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
  onSelect: (category: string | undefined, sort?: MarketplaceSort) => void;
}) {
  const notable = shelf.kind === "collection";
  const description =
    shelf.description ??
    (notable ? "Hand-picked recent additions." : undefined);
  const viewHref = notable
    ? "/marketplace?sort=recently-added"
    : `/marketplace?category=${encodeURIComponent(shelf.id)}`;
  return (
    <section
      className={`marketplace-shelf${notable ? " marketplace-shelf-notable" : ""}`}
    >
      <div className="marketplace-section-head">
        <div>
          <h2>
            {shelf.label}{"\u00a0"}
            <span>{shelf.entries.length}</span>
          </h2>
          {description === undefined ? null : <p>{description}</p>}
        </div>
        <a
          href={viewHref}
          onClick={(event) => {
            event.preventDefault();
            if (notable) {
              onSelect(undefined, "recently-added");
              return;
            }
            onSelect(shelf.id);
          }}
        >
          View all
        </a>
      </div>
      <PluginGrid
        manifest={manifest}
        entries={shelf.entries.slice(0, 3)}
        stats={stats}
        notable={notable}
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
  hero,
}: {
  options: readonly MarketplaceCategoryOption[];
  query: string;
  state: MarketplaceIndexState;
  onQueryChange: (query: string) => void;
  onStateChange: (state: MarketplaceIndexState) => void;
  hero: boolean;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  const categoryMenu = useRef<HTMLDetailsElement>(null);
  const selectedCategory = options.find(
    (option) => option.id === state.category,
  );
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !categoryMenu.current?.contains(event.target)
      ) {
        categoryMenu.current?.removeAttribute("open");
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      event.preventDefault();
      searchInput.current?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  const search = (
    <div className="marketplace-search">
      <HugeiconsIcon icon={Search01Icon} aria-hidden />
      <input
        ref={searchInput}
        aria-label="Search plugins"
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        placeholder="Search"
      />
      {query.length > 0 ? (
        <button
          type="button"
          className="marketplace-search-clear"
          aria-label="Clear search"
          onClick={() => {
            onQueryChange("");
            searchInput.current?.focus();
          }}
        >
          <HugeiconsIcon icon={Cancel01Icon} aria-hidden />
        </button>
      ) : (
        <kbd>/</kbd>
      )}
    </div>
  );
  const sortOptions: Array<{
    label: string;
    value: MarketplaceSort | undefined;
  }> = [
    { label: "Featured", value: undefined },
    { label: "New", value: "recently-added" },
    { label: "Popular", value: "most-installed" },
  ];
  return (
    <>
      {hero ? (
        <header className="marketplace-hero">
          <h1 aria-label="Make bb yours">
            Make{" "}
            <span className="bb-mark marketplace-heading-mark" aria-hidden />{" "}
            yours
          </h1>
          <p>
            Themes, providers, workflows, and tools, installed with one command.
          </p>
          <div className="marketplace-hero-search">{search}</div>
        </header>
      ) : (
        <div className="marketplace-author-search">{search}</div>
      )}
      <div className="marketplace-controls">
        <div className="marketplace-browse-controls">
          <details
            className="marketplace-category-select"
            ref={categoryMenu}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.currentTarget.removeAttribute("open");
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}
          >
            <summary
              aria-label={`Category: ${selectedCategory?.label ?? "All categories"}`}
            >
              <span>{selectedCategory?.label ?? "All categories"}</span>
              {selectedCategory ? (
                <span className="marketplace-count">
                  {selectedCategory.count}
                </span>
              ) : null}
              <HugeiconsIcon icon={ArrowDown01Icon} aria-hidden />
            </summary>
            <div
              className="marketplace-category-options"
              role="group"
              aria-label="Category"
            >
              {[
                { id: "", label: "All categories", count: undefined },
                ...options,
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={(state.category ?? "") === option.id}
                  onClick={() => {
                    onStateChange({
                      category: option.id || undefined,
                      sort: state.sort,
                    });
                    categoryMenu.current?.removeAttribute("open");
                    categoryMenu.current?.querySelector("summary")?.focus();
                  }}
                >
                  <span>{option.label}</span>
                  {option.count !== undefined ? (
                    <span className="marketplace-count">{option.count}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </details>
          <label className="marketplace-mobile-sort">
            <select
              aria-label="Sort plugins"
              value={state.sort ?? ""}
              onChange={(event) => {
                const option = sortOptions.find(
                  (option) =>
                    (option.value ?? "") === event.currentTarget.value,
                );
                if (option)
                  onStateChange({
                    category: state.category,
                    sort: option.value,
                  });
              }}
            >
              {sortOptions.map((option) => (
                <option key={option.label} value={option.value ?? ""}>
                  {option.label}
                </option>
              ))}
            </select>
            <HugeiconsIcon icon={ArrowDown01Icon} aria-hidden />
          </label>
          <div
            className="marketplace-sort-control"
            role="group"
            aria-label="Sort plugins"
          >
            {sortOptions.map((option) => (
              <button
                key={option.label}
                type="button"
                className={
                  state.sort === option.value ? "is-selected" : undefined
                }
                aria-pressed={state.sort === option.value}
                onClick={() =>
                  onStateChange({
                    category: state.category,
                    sort: option.value,
                  })
                }
              >
                {option.label}
              </button>
            ))}
          </div>
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
  hero,
}: {
  manifest: MarketplaceV2Manifest;
  entries: readonly MarketplaceV2Entry[];
  stats: MarketplaceStats | null;
  state: MarketplaceIndexState;
  onStateChange: (state: MarketplaceIndexState) => void;
  analyticsAuthor?: string;
  hero: boolean;
}) {
  const [query, setQuery] = useState("");
  const options = marketplaceCategoryOptions(manifest, entries);
  const activeCategory = options.some((option) => option.id === state.category)
    ? state.category
    : undefined;
  useMarketplacePageAnalytics(
    { category: activeCategory, sort: state.sort },
    analyticsAuthor,
  );
  const searched = filterMarketplaceEntries(manifest, entries, query);
  const filtered = filterMarketplaceCategory(
    manifest,
    searched,
    activeCategory,
  );
  const displayed =
    state.sort === undefined
      ? filtered
      : sortMarketplaceEntries(filtered, state.sort, stats);
  const isFlat =
    query.trim().length > 0 ||
    activeCategory !== undefined ||
    state.sort !== undefined;
  return (
    <section className="marketplace-browser" aria-label="Browse plugins">
      <MarketplaceToolbar
        options={options}
        query={query}
        state={{ category: activeCategory, sort: state.sort }}
        onQueryChange={setQuery}
        onStateChange={onStateChange}
        hero={hero}
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
              onSelect={(category, sort) => onStateChange({ category, sort })}
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
  useEffect(() => {
    initAnalytics();
    trackLandingEvent({
      name: "marketplace_page_viewed",
      properties: {
        ...(state.category === undefined ? {} : { category: state.category }),
        sort: state.sort ?? "featured",
        ...(author === undefined ? {} : { author }),
      },
    });
  }, [author, state.category, state.sort]);
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
        <MarketplaceBrowser
          manifest={manifest}
          entries={manifest.plugins}
          stats={stats}
          state={state}
          onStateChange={onStateChange}
          hero
        />
      </main>
      <SiteFooter />
    </div>
  );
}

function MoreFromAuthor({
  author,
  entries,
  stats,
}: {
  author: MarketplaceV2Entry["author"];
  entries: readonly MarketplaceV2Entry[];
  stats: MarketplaceStats | null;
}) {
  if (entries.length === 0) return null;
  return (
    <section className="marketplace-detail-section">
      <h2>More from {author.name}</h2>
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

function MoreInCategory({
  manifest,
  entry,
  entries,
  stats,
}: {
  manifest: MarketplaceV2Manifest;
  entry: MarketplaceV2Entry;
  entries: readonly MarketplaceV2Entry[];
  stats: MarketplaceStats | null;
}) {
  if (entries.length === 0) return null;
  const category = resolveMarketplaceCategory(manifest, entry);
  const categoryId = category?.id ?? UNCATEGORIZED_CATEGORY_ID;
  const categoryName = category?.displayName ?? "More plugins";
  return (
    <section>
      <div className="marketplace-section-head">
        <div>
          <h2>
            More in {categoryName}{"\u00a0"}
            <span>{entries.length}</span>
          </h2>
          {category?.description === undefined ? null : (
            <p>{category.description}</p>
          )}
        </div>
        <MarketplaceLink
          href={`/marketplace?category=${encodeURIComponent(categoryId)}`}
        >
          View all
        </MarketplaceLink>
      </div>
      <PluginGrid
        manifest={manifest}
        entries={entries.slice(0, 3)}
        stats={stats}
      />
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
  const categoryDefinition = resolveMarketplaceCategory(manifest, entry);
  const category = categoryDefinition?.displayName ?? "More plugins";
  const categoryId = categoryDefinition?.id ?? UNCATEGORIZED_CATEGORY_ID;
  const installs = marketplaceEntryInstalls(entry, stats);
  const repository = marketplaceRepositoryUrl(entry);
  const installCommand = marketplaceInstallCommand(entry.id);
  const authorSiblings = moreFromMarketplaceAuthor(manifest, entry);
  const categoryEntries = moreInMarketplaceCategory(manifest, entry, stats);

  const authorPath =
    entry.author.github === undefined
      ? undefined
      : marketplaceAuthorPath(entry.author.github);
  return (
    <div className="wrap plugin-pages-wrap">
      <SiteNav current="plugins" />
      <main className="marketplace-detail-main">
        <nav className="marketplace-breadcrumbs" aria-label="Breadcrumb">
          <MarketplaceLink href="/marketplace">Marketplace</MarketplaceLink>
          <span aria-hidden>/</span>
          <MarketplaceLink
            href={`/marketplace?category=${encodeURIComponent(categoryId)}`}
          >
            {category}
          </MarketplaceLink>
          <span aria-hidden>/</span>
          <strong>{entry.displayName}</strong>
        </nav>
        <header className="marketplace-detail-head">
          <PluginArtwork entry={entry} large />
          <div className="marketplace-detail-identity">
            <h1>{entry.displayName}</h1>
            <div className="marketplace-detail-attribution">
              {authorPath === undefined ? (
                <span className="marketplace-detail-author">
                  <AuthorAvatar author={entry.author} />
                  {entry.author.name}
                </span>
              ) : (
                <MarketplaceLink
                  className="marketplace-detail-author"
                  href={authorPath}
                >
                  <AuthorAvatar author={entry.author} />
                  {entry.author.name}
                </MarketplaceLink>
              )}
              <MarketplaceLink
                className="marketplace-detail-category"
                href={`/marketplace?category=${encodeURIComponent(categoryId)}`}
              >
                {category}
              </MarketplaceLink>
              <span
                className={`marketplace-detail-installs${installs === undefined ? " is-new" : ""}`}
              >
                {installs === undefined ? null : (
                  <HugeiconsIcon icon={Download01Icon} aria-hidden />
                )}
                {installs === undefined
                  ? "New"
                  : installs.toLocaleString("en-US")}
                {installs === undefined ? null : (
                  <span className="marketplace-visually-hidden">
                    {installs === 1 ? " install" : " installs"}
                  </span>
                )}
              </span>
            </div>
          </div>
          <div className="marketplace-detail-install">
            <div className="marketplace-detail-actions">
              <CommandButton
                command={installCommand}
                label={`Copy ${installCommand}`}
                size="compact"
                onCopy={(copied) => {
                  if (!copied) return;
                  trackLandingEvent({
                    name: "marketplace_install_command_copied",
                    properties: { plugin_id: entry.id },
                  });
                }}
              />
              <a
                className="marketplace-detail-source"
                href={repository}
                target="_blank"
                rel="noreferrer"
              >
                View source
                <HugeiconsIcon icon={LinkSquare02Icon} aria-hidden />
              </a>
            </div>
            <span className="marketplace-install-help">
              <MarketplaceLink href="/download/macos">
                Download bb for macOS
              </MarketplaceLink>
            </span>
          </div>
        </header>
        {
          <div className="marketplace-detail-body">
            {entry.screenshots.length === 0 ? null : (
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
            )}
            <section className="marketplace-detail-section marketplace-overview-section">
              <p className="marketplace-overview-lead">{entry.description}</p>
              {entry.overview === undefined ? null : (
                <>
                  <hr className="marketplace-overview-rule" />
                  <h2>Overview</h2>
                  <MarketplaceOverview markdown={entry.overview} />
                </>
              )}
            </section>
            <MoreFromAuthor
              author={entry.author}
              entries={authorSiblings}
              stats={stats}
            />
            <MoreInCategory
              manifest={manifest}
              entry={entry}
              entries={categoryEntries}
              stats={stats}
            />
          </div>
        }
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
        <nav className="marketplace-breadcrumbs" aria-label="Breadcrumb">
          <MarketplaceLink href="/marketplace">Marketplace</MarketplaceLink>
          <span aria-hidden>/</span>
          <strong>{author.name}</strong>
        </nav>
        <header className="marketplace-author-head">
          <AuthorAvatar author={author} large />
          <div>
            <h1>{author.name}</h1>
            <p>
              {entries.length} {entries.length === 1 ? "plugin" : "plugins"} in
              the Marketplace
            </p>
          </div>
          {author.github === undefined ? null : (
            <a
              href={`https://github.com/${encodeURIComponent(author.github)}`}
              target="_blank"
              rel="noreferrer"
            >
              <HugeiconsIcon icon={GithubIcon} aria-hidden />
              {author.github}
              <HugeiconsIcon icon={LinkSquare02Icon} aria-hidden />
            </a>
          )}
        </header>
        <MarketplaceBrowser
          manifest={manifest}
          entries={entries}
          stats={stats}
          state={state}
          onStateChange={onStateChange}
          analyticsAuthor={author.github}
          hero={false}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
