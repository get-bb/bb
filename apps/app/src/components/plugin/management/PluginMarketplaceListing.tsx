import { useEffect, useMemo, useState } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@bb/shared-ui/carousel";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ResourceDefinitionSection,
  ResourceDetailOverviewSection,
} from "@bb/shared-ui/resource-list";
import {
  PluginDetailFieldRow,
  PluginDetailTable,
} from "@/components/tools/plugin-detail-table";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import { PluginOverviewMarkdown } from "@/components/plugin/management/PluginOverviewMarkdown";
import { CatalogEntryIconChip, PluginCategoryLabel } from "./plugin-ui";
import { PluginAuthorAvatar } from "./PluginAuthorAvatar";
import { PluginAuthorLink } from "./PluginAuthorLink";
import { PluginCard, PluginCardAuthor } from "./PluginCard";
import {
  entriesByMarketplaceAuthor,
  pluginAuthorGithub,
  pluginMarketplaceAuthorKey,
} from "./plugin-marketplace-author";

function repositoryLinkLabel(url: string): string {
  return url.replace(/^https?:\/\//u, "").replace(/\/+$/u, "");
}

export function PluginMarketplaceHeaderMetadata({
  entry,
}: {
  entry: PluginCatalogSearchEntry;
}) {
  if (entry.author === null) return null;
  const author = entry.author;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <PluginAuthorAvatar
        name={author.name}
        github={pluginAuthorGithub(author)}
        size="detail"
      />
      <span className="min-w-0">
        By{" "}
        <PluginAuthorLink
          entry={entry}
          className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {author.name}
        </PluginAuthorLink>
      </span>
    </span>
  );
}

export function PluginMarketplaceCategoryPill({
  entry,
}: {
  entry: PluginCatalogSearchEntry;
}) {
  return entry.category === undefined ? null : (
    <PluginCategoryLabel categoryId={entry.categoryId} label={entry.category} />
  );
}

export function PluginMarketplaceDetailRows({
  entry,
}: {
  entry: PluginCatalogSearchEntry;
}) {
  return (
    <>
      {entry.category === undefined ? null : (
        <PluginDetailFieldRow label="Category">
          <span className="flex min-w-0 justify-end">
            <PluginMarketplaceCategoryPill entry={entry} />
          </span>
        </PluginDetailFieldRow>
      )}
      {entry.publishedAt === undefined ? null : (
        <PluginDetailFieldRow label="Listed">
          <time dateTime={entry.publishedAt}>
            {new Date(entry.publishedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </time>
        </PluginDetailFieldRow>
      )}
      {entry.updatedAt === undefined ? null : (
        <PluginDetailFieldRow label="Last updated">
          <time dateTime={entry.updatedAt}>
            {new Date(entry.updatedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </time>
        </PluginDetailFieldRow>
      )}
      <PluginDetailFieldRow label="Marketplace">
        {entry.marketplaceDisplayName}
      </PluginDetailFieldRow>
    </>
  );
}

export function PluginMarketplaceSource({
  entry,
}: {
  entry: Pick<PluginCatalogSearchEntry, "repositoryUrl">;
}) {
  if (entry.repositoryUrl === null) return null;
  return (
    <ResourceDefinitionSection label="Source">
      <a
        href={entry.repositoryUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex max-w-full items-center gap-1.5 rounded-sm text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {entry.repositoryUrl.startsWith("https://github.com/") ? (
          <Icon
            name="GithubLogo"
            className="size-4.5 shrink-0 fill-current [&_*]:stroke-0"
            aria-hidden
          />
        ) : null}
        <span className="truncate">
          {repositoryLinkLabel(entry.repositoryUrl)}
        </span>
        <Icon name="ExternalLink" className="size-3.5 shrink-0" aria-hidden />
        <span className="sr-only">Opens in a new tab</span>
      </a>
    </ResourceDefinitionSection>
  );
}

const SCREENSHOT_ROW_HEIGHT = 420;

function PluginScreenshotGallery({
  entry,
}: {
  entry: Pick<PluginCatalogSearchEntry, "screenshots" | "displayName">;
}) {
  const [api, setApi] = useState<CarouselApi>();
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => {
    if (api === undefined) return;
    const updateSelection = () => setSelectedIndex(api.selectedScrollSnap());
    updateSelection();
    api.on("select", updateSelection);
    api.on("reInit", updateSelection);
    return () => {
      api.off("select", updateSelection);
      api.off("reInit", updateSelection);
    };
  }, [api]);
  if (entry.screenshots.length === 0) return null;
  return (
    <>
      <Carousel
        setApi={setApi}
        opts={{ align: "start", containScroll: "trimSnaps" }}
        aria-label={`${entry.displayName} screenshots`}
        className={cn("w-full", entry.screenshots.length > 1 && "px-11")}
      >
        <CarouselContent className="-ml-3 items-center">
          {entry.screenshots.map((screenshot, index) => (
            <CarouselItem key={screenshot} className="min-w-0 basis-full pl-3">
              <img
                src={screenshot}
                alt={`${entry.displayName} screenshot ${index + 1}`}
                referrerPolicy="no-referrer"
                loading="lazy"
                className="mx-auto h-auto w-full rounded-md border border-border object-contain"
                style={{
                  maxHeight: `${SCREENSHOT_ROW_HEIGHT}px`,
                }}
              />
            </CarouselItem>
          ))}
        </CarouselContent>
        {entry.screenshots.length > 1 ? (
          <>
            <CarouselPrevious className="left-0 size-8" />
            <CarouselNext className="right-0 size-8" />
          </>
        ) : null}
      </Carousel>
      {entry.screenshots.length > 1 ? (
        <div
          className="flex justify-center gap-1.5"
          aria-label={`Screenshot ${selectedIndex + 1} of ${entry.screenshots.length}`}
          role="status"
        >
          {entry.screenshots.map((screenshot, index) => (
            <span
              key={screenshot}
              aria-hidden
              className={cn(
                "h-1 rounded-full transition-[width,background-color]",
                index === selectedIndex
                  ? "w-4 bg-foreground/70"
                  : "w-2 bg-border",
              )}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

export function PluginOverviewLead({ description }: { description: string }) {
  return (
    <ResourceDetailOverviewSection label="About">
      <p
        className="max-w-prose text-sm leading-relaxed text-muted-foreground"
        data-plugin-summary=""
      >
        {description}
      </p>
    </ResourceDetailOverviewSection>
  );
}

export function PluginMarketplaceOverview({
  entry,
}: {
  entry: Pick<
    PluginCatalogSearchEntry,
    "screenshots" | "description" | "overview" | "displayName"
  >;
}) {
  return (
    <>
      {entry.screenshots.length === 0 ? null : (
        <section className="space-y-3" data-resource-detail-section="overview">
          <PluginScreenshotGallery entry={entry} />
        </section>
      )}
      <PluginOverviewLead description={entry.description} />
      {entry.overview === undefined ? null : (
        <ResourceDetailOverviewSection label="Overview">
          <PluginOverviewMarkdown markdown={entry.overview} />
        </ResourceDetailOverviewSection>
      )}
    </>
  );
}

export function PluginMarketplaceListingSections({
  entry,
}: {
  entry: PluginCatalogSearchEntry;
}) {
  return (
    <>
      <PluginMarketplaceOverview entry={entry} />
      <PluginMarketplaceSource entry={entry} />
      <ResourceDefinitionSection label="Details">
        <PluginDetailTable>
          <PluginMarketplaceDetailRows entry={entry} />
        </PluginDetailTable>
      </ResourceDefinitionSection>
    </>
  );
}

export function PluginMoreFromAuthorSection({
  entry,
  catalogEntries,
  onOpenPlugin,
}: {
  entry: PluginCatalogSearchEntry;
  catalogEntries: readonly PluginCatalogSearchEntry[];
  onOpenPlugin: (pluginId: string) => void;
}) {
  const authorKey = pluginMarketplaceAuthorKey(entry);
  const moreEntries = useMemo(
    () =>
      authorKey === null
        ? []
        : entriesByMarketplaceAuthor(catalogEntries, authorKey)
            .filter(
              (candidate) =>
                candidate.compatible &&
                (candidate.marketplace !== entry.marketplace ||
                  candidate.entryId !== entry.entryId),
            )
            .sort(
              (left, right) =>
                left.displayName.localeCompare(right.displayName) ||
                left.entryId.localeCompare(right.entryId),
            )
            .slice(0, 4),
    [authorKey, catalogEntries, entry.entryId, entry.marketplace],
  );
  if (moreEntries.length === 0) return null;
  return (
    <ResourceDefinitionSection label="More from this author">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
        {moreEntries.map((candidate) => (
          <PluginCard
            key={`${candidate.marketplace}/${candidate.entryId}`}
            leading={<CatalogEntryIconChip entry={candidate} />}
            title={candidate.displayName}
            description={candidate.description}
            byline={<PluginCardAuthor entry={candidate} />}
            footerMeta={<PluginMarketplaceCategoryPill entry={candidate} />}
            headerAction={null}
            openLabel={`Open ${candidate.displayName} details`}
            onOpen={() => onOpenPlugin(candidate.pluginId)}
          />
        ))}
      </div>
    </ResourceDefinitionSection>
  );
}
