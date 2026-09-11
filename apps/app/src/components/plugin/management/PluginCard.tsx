import type { ReactNode } from "react";
import { ResourceBrowseCard } from "@bb/shared-ui/resource-list";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import { PluginAuthorAvatar } from "./PluginAuthorAvatar";
import { PluginAuthorLink } from "./PluginAuthorLink";
import { pluginAuthorGithub } from "./plugin-marketplace-author";

interface PluginCardProps {
  title: string;
  description: ReactNode;
  leading: ReactNode;
  byline: ReactNode;
  footerMeta: ReactNode;
  headerAction: ReactNode;
  openLabel: string;
  onOpen: (trigger: HTMLButtonElement) => void;
}

export function PluginCard(props: PluginCardProps) {
  return (
    <ResourceBrowseCard
      {...props}
      className="min-h-28 gap-x-2 gap-y-2 p-3"
      leadingClassName="size-6"
      title={
        <span className="line-clamp-2 whitespace-normal">{props.title}</span>
      }
    />
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
    <span className="flex min-w-0 items-center gap-1.5">
      <PluginAuthorAvatar
        name={name}
        github={github}
        official={official}
        size="detail"
      />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

interface PluginCardAuthorProps {
  entry: Pick<
    PluginCatalogSearchEntry,
    "author" | "marketplace" | "publisherLabel"
  >;
}

export function PluginCardAuthor({ entry }: PluginCardAuthorProps) {
  const name =
    entry.marketplace === "bb-official"
      ? "BB Official"
      : (entry.author?.name ?? entry.publisherLabel);
  return (
    <PluginAuthorByline
      name={name}
      github={pluginAuthorGithub(entry.author)}
      official={entry.marketplace === "bb-official"}
    >
      {entry.author === null ? (
        name
      ) : (
        <PluginAuthorLink
          entry={entry}
          className="pointer-events-auto relative z-10 rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {name}
        </PluginAuthorLink>
      )}
    </PluginAuthorByline>
  );
}
