import type { ReactNode } from "react";
import { PluginCatalogAuthorByline } from "@bb/shared-ui/plugin-catalog-card";
import { ResourceBrowseGrid } from "@bb/shared-ui/resource-list";
import { BbLogo } from "@/components/ui/bb-logo";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import { PluginAuthorAvatar } from "./PluginAuthorAvatar";
import { PluginAuthorLink } from "./PluginAuthorLink";
import { pluginAuthorGithub } from "./plugin-marketplace-author";

export function PluginCardGrid({ children }: { children: ReactNode }) {
  return (
    <ResourceBrowseGrid className="w-full grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-2">
      {children}
    </ResourceBrowseGrid>
  );
}

interface PluginAuthorBylineProps {
  name: string;
  github: string | null;
  official?: boolean;
  children: ReactNode;
}

export function PluginAuthorByline({
  name,
  github,
  official,
  children,
}: PluginAuthorBylineProps) {
  return (
    <PluginCatalogAuthorByline
      name={name}
      github={github}
      official={official}
      officialMark={<BbLogo className="size-4/5" />}
    >
      {children}
    </PluginCatalogAuthorByline>
  );
}

interface PluginCardAuthorProps {
  entry: Pick<
    PluginCatalogSearchEntry,
    "author" | "marketplace" | "publisherLabel"
  >;
}

function pluginCardAuthorName(entry: PluginCardAuthorProps["entry"]): string {
  return entry.marketplace === "bb-official"
    ? "BB Official"
    : (entry.author?.name ?? entry.publisherLabel);
}

export function PluginCardAuthorAvatar({ entry }: PluginCardAuthorProps) {
  return (
    <PluginAuthorAvatar
      name={pluginCardAuthorName(entry)}
      github={pluginAuthorGithub(entry.author)}
      official={entry.marketplace === "bb-official"}
      size="detail"
    />
  );
}

export function PluginCardAuthorName({ entry }: PluginCardAuthorProps) {
  const name = pluginCardAuthorName(entry);
  return entry.author === null ? (
    name
  ) : (
    <PluginAuthorLink
      entry={entry}
      className="pointer-events-auto relative z-10 rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {name}
    </PluginAuthorLink>
  );
}

export function PluginCardAuthor({ entry }: PluginCardAuthorProps) {
  return (
    <PluginAuthorByline
      name={pluginCardAuthorName(entry)}
      github={pluginAuthorGithub(entry.author)}
      official={entry.marketplace === "bb-official"}
    >
      <PluginCardAuthorName entry={entry} />
    </PluginAuthorByline>
  );
}
