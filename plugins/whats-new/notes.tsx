import { useId, useState, type ReactNode } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { InlineMarkdown } from "./inline-markdown.js";
import { ReleaseVisual } from "./release-visual.js";
import { WHATS_NEW_SECTION_ID } from "./seen.js";
import { ShowMeAction } from "./show-me.js";
import {
  changelogUrl,
  type ReleaseNotes,
  type ReleaseNotesBlock,
} from "./state.js";

export interface WhatsNewNotesData {
  current: ReleaseNotes;
  skipped: readonly ReleaseNotes[];
  updatedFrom: string | null;
  available: ReleaseNotes | null;
}

type ReleaseSection = ReleaseNotes["sections"][number];

function Blocks({
  blocks,
  itemAction,
}: {
  blocks: readonly ReleaseNotesBlock[];
  itemAction?: (item: string) => ReactNode;
}) {
  return blocks.map((block, index) =>
    block.kind === "list" ? (
      <ul key={index} className="mt-3 flex flex-col gap-2 first:mt-0">
        {block.items.map((item) => (
          <li
            key={item}
            className="relative pl-5 text-sm leading-relaxed text-muted-foreground before:absolute before:left-0.5 before:top-[0.62em] before:size-1.5 before:rounded-xs before:bg-subtle-foreground/40"
          >
            <InlineMarkdown text={item} />
            {itemAction?.(item)}
          </li>
        ))}
      </ul>
    ) : (
      <p
        key={index}
        className="mt-3 text-sm leading-relaxed text-muted-foreground first:mt-0"
      >
        <InlineMarkdown text={block.text} />
      </p>
    ),
  );
}

function splitSections(release: ReleaseNotes) {
  const thanks = release.sections.find((section) => section.title === "Thanks");
  const content = release.sections.filter((section) => section !== thanks);
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

function contributorHandles(release: ReleaseNotes): string[] {
  const { thanks } = splitSections(release);
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

function ThanksLine({ release }: { release: ReleaseNotes }) {
  const handles = contributorHandles(release);
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

function SectionTitle({ title }: { title: string }) {
  return (
    <h4 className="mb-3 text-sm font-semibold tracking-tight text-foreground">
      {title}
    </h4>
  );
}

function SectionList({
  sections,
  onShowMe,
}: {
  sections: readonly ReleaseSection[];
  onShowMe: ((item: string) => void) | null;
}) {
  return sections.map((section) => (
    <div key={section.title} className="mt-5 first:mt-3">
      <SectionTitle title={section.title} />
      <Blocks
        blocks={section.blocks}
        itemAction={
          section.title === "Highlights" && onShowMe !== null
            ? (item) => <ShowMeAction item={item} onShowMe={onShowMe} />
            : undefined
        }
      />
    </div>
  ));
}

function DisclosureButton({
  expanded,
  controls,
  label,
  onToggle,
  className,
}: {
  expanded: boolean;
  controls: string;
  label: string;
  onToggle(): void;
  className: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-expanded={expanded}
      aria-controls={controls}
      className={className}
      onClick={onToggle}
    >
      <Icon
        aria-hidden
        name="ChevronRight"
        className={cn(
          "size-3.5 transition-transform motion-reduce:transition-none",
          expanded && "rotate-90",
        )}
      />
      {label}
    </Button>
  );
}

function ReleaseBody({ release }: { release: ReleaseNotes }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const { primary, rest } = splitSections(release);
  const lede = release.lede.find((block) => block.kind === "paragraph");
  const ledeList = release.lede.filter((block) => block.kind === "list");
  const hasMore = rest.length > 0 || contributorHandles(release).length > 0;
  return (
    <div className="min-w-0">
      {lede === undefined ? null : (
        <p className="text-base leading-relaxed text-muted-foreground">
          <InlineMarkdown text={lede.text} />
        </p>
      )}
      {primary === null && ledeList.length === 0 ? null : (
        <div className={lede === undefined ? undefined : "mt-5"}>
          {primary === null ? null : <SectionTitle title={primary.title} />}
          <Blocks blocks={primary === null ? ledeList : primary.blocks} />
        </div>
      )}
      {hasMore ? (
        <DisclosureButton
          expanded={expanded}
          controls={panelId}
          label={
            expanded
              ? "Show less"
              : rest.length > 0
                ? "Show all changes"
                : "Show contributors"
          }
          onToggle={() => setExpanded((value) => !value)}
          className="-ml-3 mt-3 text-muted-foreground"
        />
      ) : null}
      <div id={panelId} hidden={!expanded}>
        {rest.map((section) => (
          <div key={section.title} className="mt-6 first:mt-3">
            <SectionTitle title={section.title} />
            <Blocks blocks={section.blocks} />
          </div>
        ))}
        <ThanksLine release={release} />
      </div>
    </div>
  );
}

function ReleaseRow({
  release,
  badge,
}: {
  release: ReleaseNotes;
  badge?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div data-whats-new-release={release.version}>
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
                {release.headline ?? `bb ${release.version}`}
              </span>
              {badge === undefined ? null : (
                <span className="shrink-0 rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-2xs leading-none text-subtle-foreground">
                  {badge}
                </span>
              )}
            </span>
            <span className="mt-0.5 block text-xs leading-snug text-subtle-foreground">
              {release.date === null
                ? release.version
                : `${release.version} · ${release.date}`}
            </span>
          </span>
        </button>
      </div>
      <div id={panelId} hidden={!open} className="mt-2 pl-5.5">
        {open ? <ReleaseBody release={release} /> : null}
      </div>
    </div>
  );
}

function ReleaseHeroImage({
  hero,
}: {
  hero: NonNullable<ReleaseNotes["hero"]>;
}) {
  return (
    <div
      data-whats-new-hero
      className="mt-4 overflow-hidden rounded-md border border-border bg-muted"
    >
      <img
        src={hero.src}
        alt={hero.alt}
        loading="lazy"
        className={cn("block w-full", hero.darkSrc !== null && "dark:hidden")}
      />
      {hero.darkSrc === null ? null : (
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
  release,
  metaLine,
  onShowMe,
}: {
  release: ReleaseNotes;
  metaLine: string;
  onShowMe: ((item: string) => void) | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const summary = release.lede.find((block) => block.kind === "paragraph");
  const ledeList = release.lede.filter((block) => block.kind === "list");
  const sections = release.sections.filter(
    (section) => section.title !== "Thanks",
  );
  const hasMore =
    release.hero !== null ||
    ledeList.length > 0 ||
    sections.length > 0 ||
    contributorHandles(release).length > 0;
  return (
    <div data-whats-new-current className="flex min-w-0 items-start gap-3">
      <ReleaseVisual visual={release.visual} className="size-10" />
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-snug text-subtle-foreground">
          {metaLine}
        </p>
        {release.headline === null ? null : (
          <h3 className="mt-0.5 text-sm font-semibold leading-snug text-foreground">
            {release.headline}
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
            <InlineMarkdown text={summary.text} />
          </p>
        )}
        {hasMore ? (
          <DisclosureButton
            expanded={expanded}
            controls={panelId}
            label={expanded ? "Show less" : "Show all changes"}
            onToggle={() => setExpanded((value) => !value)}
            className="-ml-3 mt-1 text-muted-foreground"
          />
        ) : null}
        <div id={panelId} hidden={!expanded} className="pb-1">
          {release.hero === null ? null : (
            <ReleaseHeroImage hero={release.hero} />
          )}
          {ledeList.length === 0 ? null : (
            <div className="mt-4">
              <Blocks blocks={ledeList} />
            </div>
          )}
          <SectionList sections={sections} onShowMe={onShowMe} />
          <ThanksLine release={release} />
        </div>
      </div>
    </div>
  );
}

export function WhatsNewNotes({
  current,
  skipped,
  updatedFrom,
  available,
  onShowMe = null,
}: WhatsNewNotesData & { onShowMe?: ((item: string) => void) | null }) {
  const metaLine = [
    `bb ${current.version}`,
    current.date,
    updatedFrom === null ? null : `Updated from ${updatedFrom}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <section
      id={WHATS_NEW_SECTION_ID}
      data-whats-new={current.version}
      aria-labelledby={`${WHATS_NEW_SECTION_ID}-title`}
      className="space-y-3 outline-none"
    >
      <div className="flex flex-row items-center justify-between gap-4">
        <h2
          id={`${WHATS_NEW_SECTION_ID}-title`}
          className="min-w-0 text-sm font-semibold text-foreground"
        >
          What&rsquo;s new
        </h2>
        <UrlLink
          href={changelogUrl(current.version)}
          aria-label={`Open the full bb ${current.version} changelog`}
          className="inline-flex shrink-0 items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Full changelog
          <Icon aria-hidden name="ExternalLink" className="size-3" />
        </UrlLink>
      </div>
      <div className="rounded-lg border border-border bg-card px-4 py-3.5">
        <CurrentRelease
          release={current}
          metaLine={metaLine}
          onShowMe={onShowMe}
        />
        {available === null ? null : (
          <div data-whats-new-available className="mt-4">
            <ReleaseRow release={available} badge="Update available" />
          </div>
        )}
        {skipped.length === 0 ? null : (
          <div data-whats-new-skipped className="mt-4">
            <h4 className="mb-1.5 text-xs font-medium text-subtle-foreground">
              Also new since {updatedFrom}
            </h4>
            <div className="space-y-1">
              {skipped.map((release) => (
                <ReleaseRow key={release.version} release={release} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
