import type { ReactNode } from "react";
import {
  ResourceBrowseCard,
  ResourceBrowseGrid,
} from "@bb/shared-ui/resource-list";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import { PluginAuthorAvatar } from "./PluginAuthorAvatar";
import { PluginAuthorLink } from "./PluginAuthorLink";
import { pluginAuthorGithub } from "./plugin-marketplace-author";

export function PluginCardGrid({ children }: { children: ReactNode }) {
  return (
    <ResourceBrowseGrid className="w-full grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3">
      {children}
    </ResourceBrowseGrid>
  );
}

interface PluginCardProps {
  title: string;
  description: ReactNode;
  leading: ReactNode;
  byline: ReactNode;
  footerAction: ReactNode;
  openLabel: string;
  onOpen: (trigger: HTMLButtonElement) => void;
}

export function PluginCard({ byline, footerAction, ...props }: PluginCardProps) {
  return (
    <ResourceBrowseCard
      {...props}
      className="h-full min-h-40 grid-cols-[minmax(0,1fr)_0px] gap-x-0 gap-y-3 rounded-xl p-4"
      leadingClassName="size-10"
      description={
        <span className="block min-h-[2lh]">{props.description}</span>
      }
      title={
        <span className="line-clamp-2 whitespace-normal">{props.title}</span>
      }
      footer={
        <div className="flex min-w-0 items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-subtle-foreground">
          <span className="min-w-0 truncate">{byline}</span>
          <span className="pointer-events-auto shrink-0">{footerAction}</span>
        </div>
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
          className="pointer-events-auto relative z-10 rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {name}
        </PluginAuthorLink>
      )}
    </PluginAuthorByline>
  );
}
