import { Button } from "@bb/shared-ui/button";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
} from "@bb/shared-ui/resource-list";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import { PluginOverviewMarkdown } from "@/components/plugin/management/PluginOverviewMarkdown";
import {
  CatalogEntryIconChip,
  formatUrlLabel,
  PluginCategoryLabel,
} from "./plugin-ui";
import { PluginAuthorLink } from "./PluginAuthorLink";
import { PluginCard, PluginCardGrid, PluginCardAuthor } from "./PluginCard";
import {
  entriesByMarketplaceAuthor,
  pluginMarketplaceAuthorKey,
} from "./plugin-marketplace-author";

export function PluginMarketplaceCategoryPill({
  entry,
}: {
  entry: PluginCatalogSearchEntry;
}) {
  return entry.category === undefined ? null : (
    <PluginCategoryLabel categoryId={entry.categoryId} label={entry.category} />
  );
}

function PluginMarketplaceDetail({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-2xs font-medium text-subtle-foreground">{label}</dt>
      <dd className="min-w-0 text-xs text-muted-foreground">{children}</dd>
    </div>
  );
}

function PluginMarketplaceDetails({
  entry,
}: {
  entry: PluginCatalogSearchEntry;
}) {
  return (
    <ResourceDefinitionSection label="Details">
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {entry.publishedAt === undefined ? null : (
          <PluginMarketplaceDetail label="Listed">
            <time dateTime={entry.publishedAt}>
              {new Date(entry.publishedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </time>
          </PluginMarketplaceDetail>
        )}
        <PluginMarketplaceDetail label="Marketplace">
          {entry.marketplaceDisplayName}
        </PluginMarketplaceDetail>
      </dl>
    </ResourceDefinitionSection>
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
        <span className="truncate">{formatUrlLabel(entry.repositoryUrl)}</span>
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
  entry: PluginCatalogSearchEntry;
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
        <CarouselContent
          className="-ml-3 items-center"
          style={{ minHeight: `${SCREENSHOT_ROW_HEIGHT}px` }}
        >
          {entry.screenshots.map((screenshot, index) => (
            <CarouselItem key={screenshot} className="basis-auto pl-3">
              <img
                src={screenshot}
                alt={`${entry.displayName} screenshot ${index + 1}`}
                referrerPolicy="no-referrer"
                loading="lazy"
                className="h-auto w-auto rounded-md border border-border object-contain"
                style={{
                  maxHeight: `${SCREENSHOT_ROW_HEIGHT}px`,
                  maxWidth: `${SCREENSHOT_ROW_HEIGHT * 2}px`,
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
    <p
      className="max-w-prose text-base leading-relaxed text-foreground"
      data-plugin-summary=""
    >
      {description}
    </p>
  );
}

function PluginMarketplaceOverview({
  entry,
}: {
  entry: PluginCatalogSearchEntry;
}) {
  return (
    <section className="space-y-6" data-resource-detail-section="overview">
      <PluginScreenshotGallery entry={entry} />
      <div className="space-y-3">
        <PluginOverviewLead description={entry.description} />
        {entry.overview === undefined ? null : (
          <>
            <hr className="border-t border-border" />
            <h2 className="text-sm font-medium text-foreground">Overview</h2>
            <PluginOverviewMarkdown markdown={entry.overview} />
          </>
        )}
      </div>
    </section>
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
      <PluginMarketplaceDetails entry={entry} />
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
    <ResourceDefinitionSection
      label="More from this author"
      actions={
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-auto text-xs font-normal text-muted-foreground"
        >
          <PluginAuthorLink entry={entry}>
            View all
            <Icon name="ChevronRight" className="size-3" aria-hidden />
          </PluginAuthorLink>
        </Button>
      }
    >
      <PluginCardGrid>
        {moreEntries.map((candidate) => (
          <PluginCard
            key={`${candidate.marketplace}/${candidate.entryId}`}
            leading={<CatalogEntryIconChip entry={candidate} compact />}
            title={candidate.displayName}
            description={candidate.description}
            byline={<PluginCardAuthor entry={candidate} />}
            badge={
              candidate.category === undefined
                ? null
                : {
                    kind: "category",
                    categoryId: candidate.categoryId,
                    label: candidate.category,
                  }
            }
            headerAction={null}
            openLabel={`Open ${candidate.displayName} details`}
            onOpen={() => onOpenPlugin(candidate.pluginId)}
          />
        ))}
      </PluginCardGrid>
    </ResourceDefinitionSection>
  );
}
