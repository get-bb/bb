import type { PluginCatalogAuthor } from "@bb/server-contract";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";

const GITHUB_AUTHOR_PREFIX = "github:";
const NAME_AUTHOR_PREFIX = "name:";

export function pluginAuthorGithub(
  author: PluginCatalogAuthor | null,
): string | null {
  if (author?.url === null || author?.url === undefined) return null;
  try {
    const url = new URL(author.url);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
      return null;
    }
    const [github] = url.pathname.split("/").filter(Boolean);
    return github ?? null;
  } catch {
    return null;
  }
}

export function pluginMarketplaceAuthorKey(
  entry: Pick<PluginCatalogSearchEntry, "author" | "marketplace">,
): string | null {
  if (entry.author === null) return null;
  const github = pluginAuthorGithub(entry.author);
  const identity =
    github === null
      ? `${NAME_AUTHOR_PREFIX}${entry.author.name}`
      : `${GITHUB_AUTHOR_PREFIX}${github.toLocaleLowerCase()}`;
  return `${entry.marketplace.length}:${entry.marketplace}:${identity}`;
}

export function entriesByMarketplaceAuthor<
  Entry extends Pick<PluginCatalogSearchEntry, "author" | "marketplace">,
>(entries: readonly Entry[], authorKey: string): Entry[] {
  return entries.filter(
    (entry) => pluginMarketplaceAuthorKey(entry) === authorKey,
  );
}
