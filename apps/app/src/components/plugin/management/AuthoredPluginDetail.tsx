import type { PluginListingRecord } from "@bb/server-contract";
import {
  ResourceDefinitionSection,
  ResourceDetailPage,
  ResourceDetailStack,
} from "@bb/shared-ui/resource-list";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import {
  PluginDetailFieldRow,
  PluginDetailTable,
} from "@/components/tools/plugin-detail-table";
import { PluginAuthorByline } from "./PluginCard";
import { PluginListingActions } from "./PluginListingActions";
import {
  PluginMarketplaceOverview,
  PluginMarketplaceSource,
} from "./PluginMarketplaceListing";
import { pluginCatalogCategory } from "@bb/domain";

interface AuthoredPluginDetailProps {
  record: PluginListingRecord;
}

export function AuthoredPluginDetail({ record }: AuthoredPluginDetailProps) {
  const { entry, lifecycle } = record;
  const authorUrl =
    entry.author.url ??
    (entry.author.github ? `https://github.com/${entry.author.github}` : null);
  const repositoryUrl = "git" in entry.source ? entry.source.git.url : null;
  const category =
    entry.category === undefined
      ? undefined
      : (pluginCatalogCategory(entry.category)?.displayName ?? entry.category);
  const status =
    lifecycle.status === "draft"
      ? "Not published"
      : lifecycle.status === "in-review"
        ? "In review"
        : "Published";
  return (
    <ResourceDetailPage
      maxWidthClassName="max-w-5xl"
      leading={
        <PluginIcon
          pluginId={record.pluginId}
          icon={typeof entry.icon === "string" ? entry.icon : null}
          compactIconUrl={
            typeof entry.icon === "string" ? undefined : entry.icon.url
          }
          className="size-6"
        />
      }
      leadingClassName="size-6"
      title={entry.displayName}
      metadata={
        <PluginAuthorByline
          name={entry.author.name}
          github={entry.author.github ?? null}
        >
          {authorUrl === null ? (
            entry.author.name
          ) : (
            <a
              className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              href={authorUrl}
              target="_blank"
              rel="noreferrer"
            >
              {entry.author.name}
            </a>
          )}
        </PluginAuthorByline>
      }
      actions={<PluginListingActions record={record} />}
    >
      <ResourceDetailStack>
        <PluginMarketplaceOverview
          entry={{
            ...entry,
            screenshots: (entry.screenshots ?? []).filter((url) =>
              url.startsWith("https://"),
            ),
          }}
        />
        <PluginMarketplaceSource entry={{ repositoryUrl }} />
        <ResourceDefinitionSection label="Details">
          <PluginDetailTable>
            <PluginDetailFieldRow label="Publication">
              {status}
            </PluginDetailFieldRow>
            {category !== undefined ? (
              <PluginDetailFieldRow label="Category">
                {category}
              </PluginDetailFieldRow>
            ) : null}
            {lifecycle.status !== "draft" ? (
              <PluginDetailFieldRow label="Submission">
                <a
                  href={lifecycle.pullRequest.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  View marketplace pull request
                </a>
              </PluginDetailFieldRow>
            ) : null}
          </PluginDetailTable>
        </ResourceDefinitionSection>
      </ResourceDetailStack>
    </ResourceDetailPage>
  );
}
