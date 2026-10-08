import { useEffect, useId, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { ReleaseVisual } from "@/components/release-art/ReleaseVisual";
import {
  SettingsBadge,
  SettingsSection,
} from "@/components/ui/settings-section";
import { rawStringLocalStorage } from "@/lib/browser-storage";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import {
  CHANGELOG_ENTRIES,
  changelogUrl,
  fetchChangelogEntries,
  recordWhatsNewVersion,
  RELEASE_META,
  selectWhatsNewReleases,
  type ChangelogBlock,
  type ChangelogEntry,
  type ReleaseHero,
  type ReleaseMeta,
  type WhatsNewReleases,
} from "./changelog-preview";
import {
  notifyWhatsNewSeenVersionChanged,
  WHATS_NEW_SECTION_ID,
} from "./whats-new-seen";

const CHANGELOG_STALE_TIME_MS = 5 * 60_000;

const INLINE_COMPONENTS: Components = {
  p: ({ children }) => <>{children}</>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
      onClick={(event) => {
        event.preventDefault();
        if (href !== undefined) {
          openUrlInExternalBrowser(href);
        }
      }}
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded-sm bg-muted px-1 py-px font-mono text-xs text-foreground">
      {children}
    </code>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
};

function Inline({ text }: { text: string }) {
  return (
    <ReactMarkdown components={INLINE_COMPONENTS} skipHtml>
      {text}
    </ReactMarkdown>
  );
}

function Blocks({ blocks }: { blocks: ChangelogBlock[] }) {
  return blocks.map((block, index) =>
    block.kind === "list" ? (
      <ul key={index} className="mt-3 flex flex-col gap-2 first:mt-0">
        {block.items.map((item) => (
          <li
            key={item}
            className="relative pl-5 text-sm leading-relaxed text-muted-foreground before:absolute before:left-0.5 before:top-[0.62em] before:size-1.5 before:rounded-xs before:bg-subtle-foreground/40"
          >
            <Inline text={item} />
          </li>
        ))}
      </ul>
    ) : (
      <p
        key={index}
        className="mt-3 text-sm leading-relaxed text-muted-foreground first:mt-0"
      >
        <Inline text={block.text} />
      </p>
    ),
  );
}

function splitSections(entry: ChangelogEntry) {
  const thanks = entry.sections.find((section) => section.title === "Thanks");
  const content = entry.sections.filter((section) => section !== thanks);
  const primary =
    content.find((section) => section.title === "Highlights") ??
    content[0] ??
    null;
  return {
    primary,
    rest: content.filter((section) => section !== primary),
    thanks,
  };
}

function contributorHandles(entry: ChangelogEntry): string[] {
  const { thanks } = splitSections(entry);
  if (thanks === undefined) {
    return [];
  }
  const text = thanks.blocks
    .map((block) =>
      block.kind === "paragraph" ? block.text : block.items.join(" "),
    )
    .join(" ");
  return [...text.matchAll(/\[(@[^\]]+)\]/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

function ThanksLine({ entry }: { entry: ChangelogEntry }) {
  const handles = contributorHandles(entry);
  if (handles.length === 0) {
    return null;
  }
  const shown = handles.slice(0, 3);
  const remaining = handles.length - shown.length;
  return (
    <p className="mt-4 text-xs leading-snug text-subtle-foreground">
      Thanks to {shown.join(", ")}
      {remaining > 0 ? `, and ${remaining} more contributors` : ""}.
    </p>
  );
}

function headlineFor(entry: ChangelogEntry): string {
  return RELEASE_META[entry.version]?.headline ?? `bb ${entry.version}`;
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h4 className="mb-3 text-sm font-semibold tracking-tight text-foreground">
      {title}
    </h4>
  );
}

function ReleaseNotes({ entry }: { entry: ChangelogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const { primary, rest } = splitSections(entry);
  const lede = entry.lede.find((block) => block.kind === "paragraph");
  const ledeList = entry.lede.filter((block) => block.kind === "list");
  const hasMore = rest.length > 0 || contributorHandles(entry).length > 0;
  return (
    <div className="min-w-0">
      {lede === undefined ? null : (
        <p className="text-base leading-relaxed text-muted-foreground">
          <Inline text={lede.text} />
        </p>
      )}
      {primary === null && ledeList.length === 0 ? null : (
        <div className={lede === undefined ? undefined : "mt-5"}>
          {primary === null ? null : <SectionTitle title={primary.title} />}
          <Blocks blocks={primary === null ? ledeList : primary.blocks} />
        </div>
      )}
      {hasMore ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-controls={panelId}
          className="-ml-3 mt-3 text-muted-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          <Icon
            aria-hidden
            name="ChevronRight"
            className={cn(
              "size-3.5 transition-transform motion-reduce:transition-none",
              expanded && "rotate-90",
            )}
          />
          {expanded
            ? "Show less"
            : rest.length > 0
              ? "Show all changes"
              : "Show contributors"}
        </Button>
      ) : null}
      <div id={panelId} hidden={!expanded}>
        {rest.map((section) => (
          <div key={section.title} className="mt-6 first:mt-3">
            <SectionTitle title={section.title} />
            <Blocks blocks={section.blocks} />
          </div>
        ))}
        <ThanksLine entry={entry} />
      </div>
    </div>
  );
}

function ReleaseRow({
  entry,
  badge,
}: {
  entry: ChangelogEntry;
  badge?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const date = RELEASE_META[entry.version]?.date;
  return (
    <div data-whats-new-release={entry.version}>
      <div className="-mx-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-md px-2 py-1 text-left hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon
            aria-hidden
            name="ChevronRight"
            className={cn(
              "mt-0.5 size-3.5 shrink-0 text-subtle-foreground transition-transform motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 text-sm font-medium text-foreground">
                {headlineFor(entry)}
              </span>
              {badge === undefined ? null : (
                <SettingsBadge>{badge}</SettingsBadge>
              )}
            </span>
            <span className="mt-0.5 block text-xs leading-snug text-subtle-foreground">
              {date === undefined
                ? entry.version
                : `${entry.version} · ${date}`}
            </span>
          </span>
        </button>
      </div>
      <div id={panelId} hidden={!open} className="mt-2 pl-5.5">
        {open ? <ReleaseNotes entry={entry} /> : null}
      </div>
    </div>
  );
}

function useAvailableRelease(
  availableVersion: string | null,
): ChangelogEntry | null {
  const query = useQuery({
    queryKey: ["updates", "changelog", "entries"],
    queryFn: ({ signal }) => fetchChangelogEntries(fetch, signal),
    enabled: availableVersion !== null,
    retry: false,
    staleTime: CHANGELOG_STALE_TIME_MS,
  });
  if (availableVersion === null) {
    return null;
  }
  return (
    (query.data ?? CHANGELOG_ENTRIES).find(
      (entry) => entry.version === availableVersion,
    ) ?? null
  );
}

export function WhatsNewSection({
  installedVersion,
  availableVersion,
}: {
  installedVersion: string | null;
  availableVersion: string | null;
}) {
  const [previousVersion] = useState(() => {
    const seen = selectWhatsNewReleases({
      entries: CHANGELOG_ENTRIES,
      installedVersion,
      previousVersion: null,
    });
    return seen === null
      ? null
      : recordWhatsNewVersion(rawStringLocalStorage, seen.current.version);
  });
  useEffect(() => {
    notifyWhatsNewSeenVersionChanged();
  }, []);
  const available = useAvailableRelease(availableVersion);
  const releases = selectWhatsNewReleases({
    entries: CHANGELOG_ENTRIES,
    installedVersion,
    previousVersion,
  });
  if (releases === null) {
    return null;
  }
  return (
    <WhatsNewView
      releases={releases}
      meta={RELEASE_META[releases.current.version] ?? null}
      available={available}
    />
  );
}

function ReleaseHeroImage({ hero }: { hero: ReleaseHero }) {
  return (
    <div
      data-whats-new-hero
      className="mt-4 overflow-hidden rounded-md border border-border bg-muted"
    >
      <img
        src={hero.src}
        alt={hero.alt}
        loading="lazy"
        className={cn(
          "block w-full",
          hero.darkSrc !== undefined && "dark:hidden",
        )}
      />
      {hero.darkSrc === undefined ? null : (
        <img
          src={hero.darkSrc}
          alt={hero.alt}
          loading="lazy"
          className="hidden w-full dark:block"
        />
      )}
    </div>
  );
}

function CurrentRelease({
  entry,
  meta,
  metaLine,
}: {
  entry: ChangelogEntry;
  meta: ReleaseMeta | null;
  metaLine: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const summary = entry.lede.find((block) => block.kind === "paragraph");
  const ledeList = entry.lede.filter((block) => block.kind === "list");
  const sections = entry.sections.filter(
    (section) => section.title !== "Thanks",
  );
  const hasMore =
    meta?.hero !== undefined ||
    ledeList.length > 0 ||
    sections.length > 0 ||
    contributorHandles(entry).length > 0;
  return (
    <div data-whats-new-current className="flex min-w-0 items-start gap-3">
      <ReleaseVisual visual={meta?.visual} className="size-10" />
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-snug text-subtle-foreground">
          {metaLine}
        </p>
        {meta === null ? null : (
          <h3 className="mt-0.5 text-sm font-semibold leading-snug text-foreground">
            {meta.headline}
          </h3>
        )}
        {summary === undefined ? null : (
          <p
            data-whats-new-summary
            className={cn(
              "mt-0.5 text-sm leading-relaxed text-muted-foreground",
              !expanded && "line-clamp-1",
            )}
          >
            <Inline text={summary.text} />
          </p>
        )}
        {hasMore ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            aria-controls={panelId}
            className="-ml-3 mt-1 text-muted-foreground"
            onClick={() => setExpanded((value) => !value)}
          >
            <Icon
              aria-hidden
              name="ChevronRight"
              className={cn(
                "size-3.5 transition-transform motion-reduce:transition-none",
                expanded && "rotate-90",
              )}
            />
            {expanded ? "Show less" : "Show all changes"}
          </Button>
        ) : null}
        <div id={panelId} hidden={!expanded} className="pb-1">
          {meta?.hero === undefined ? null : (
            <ReleaseHeroImage hero={meta.hero} />
          )}
          {ledeList.length === 0 ? null : (
            <div className="mt-4">
              <Blocks blocks={ledeList} />
            </div>
          )}
          {sections.map((section) => (
            <div key={section.title} className="mt-5 first:mt-3">
              <SectionTitle title={section.title} />
              <Blocks blocks={section.blocks} />
            </div>
          ))}
          <ThanksLine entry={entry} />
        </div>
      </div>
    </div>
  );
}

export function WhatsNewView({
  releases: { current, skipped, updatedFrom },
  meta,
  available,
}: {
  releases: WhatsNewReleases;
  meta: ReleaseMeta | null;
  available: ChangelogEntry | null;
}) {
  const metaLine = [
    `bb ${current.version}`,
    meta?.date,
    updatedFrom === null ? undefined : `Updated from ${updatedFrom}`,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
  return (
    <div id={WHATS_NEW_SECTION_ID} data-whats-new={current.version}>
      <SettingsSection
        title="What's new"
        action={
          <button
            type="button"
            aria-label={`Open the full bb ${current.version} changelog`}
            className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() =>
              openUrlInExternalBrowser(changelogUrl(current.version))
            }
          >
            Full changelog
            <Icon aria-hidden name="ExternalLink" className="size-3" />
          </button>
        }
        actionPlacement="inline"
      >
        <CurrentRelease entry={current} meta={meta} metaLine={metaLine} />
        {available === null ? null : (
          <div data-whats-new-available className="mt-4">
            <ReleaseRow entry={available} badge="Update available" />
          </div>
        )}
        {skipped.length === 0 ? null : (
          <div data-whats-new-skipped className="mt-4">
            <h4 className="mb-1.5 text-xs font-medium text-subtle-foreground">
              Also new since {updatedFrom}
            </h4>
            <div className="space-y-1">
              {skipped.map((entry) => (
                <ReleaseRow key={entry.version} entry={entry} />
              ))}
            </div>
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
