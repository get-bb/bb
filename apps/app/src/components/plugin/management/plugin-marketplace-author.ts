import type { PluginCatalogAuthor } from "@bb/server-contract";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";

const GITHUB_AUTHOR_PREFIX = "github:";
const NAME_AUTHOR_PREFIX = "name:";
const URL_AUTHOR_PREFIX = "url:";

function authorUrlIdentity(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const pathname = parsed.pathname.replace(/\/+$/u, "");
    return `${parsed.origin}${pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export function pluginAuthorGithub(
  author: PluginCatalogAuthor | null,
): string | null {
  return author?.github ?? null;
}

export function pluginMarketplaceAuthorKey(
  entry: Pick<PluginCatalogSearchEntry, "author" | "marketplace">,
): string | null {
  if (entry.author === null) return null;
  const github = pluginAuthorGithub(entry.author);
  const identity =
    github !== null
      ? `${GITHUB_AUTHOR_PREFIX}${github.toLowerCase()}`
      : entry.author.url !== null
        ? `${URL_AUTHOR_PREFIX}${authorUrlIdentity(entry.author.url)}`
        : `${NAME_AUTHOR_PREFIX}${entry.author.name}`;
  return `${entry.marketplace.length}:${entry.marketplace}:${identity}`;
}

export function entriesByMarketplaceAuthor<
  Entry extends Pick<PluginCatalogSearchEntry, "author" | "marketplace">,
>(entries: readonly Entry[], authorKey: string): Entry[] {
  return entries.filter(
    (entry) => pluginMarketplaceAuthorKey(entry) === authorKey,
  );
}
