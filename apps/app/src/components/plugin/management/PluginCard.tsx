import type { ReactNode } from "react";
import {
  ResourceBrowseCard,
  ResourceBrowseGrid,
} from "@bb/shared-ui/resource-list";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import { PluginAuthorAvatar } from "./PluginAuthorAvatar";
import { PluginAuthorLink } from "./PluginAuthorLink";
import { pluginAuthorGithub } from "./plugin-marketplace-author";
import { PluginCategoryLabel } from "./plugin-ui";

export function PluginCardGrid({ children }: { children: ReactNode }) {
  return (
    <ResourceBrowseGrid
      className="w-full grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-2"
    >
      {children}
    </ResourceBrowseGrid>
  );
}

interface PluginCardProps {
  title: string;
  description: ReactNode;
  leading: ReactNode;
  byline: ReactNode;
  badge:
    | { kind: "category"; categoryId: string | undefined; label: string }
    | { kind: "local" }
    | null;
  headerAction: ReactNode;
  openLabel: string;
  onOpen: (trigger: HTMLButtonElement) => void;
}

export function PluginCard({ badge, ...props }: PluginCardProps) {
  return (
    <ResourceBrowseCard
      {...props}
      className="min-h-28 gap-x-2 gap-y-2 p-3"
      leadingClassName="size-6"
      title={
        <span className="line-clamp-2 whitespace-normal">{props.title}</span>
      }
      footerMeta={
        badge === null ? null : (
          <PluginCategoryLabel
            categoryId={
              badge.kind === "category" ? badge.categoryId : undefined
            }
            label={badge.kind === "category" ? badge.label : "Local"}
          />
        )
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
