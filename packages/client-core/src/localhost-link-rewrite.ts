export const REWRITE_LOCALHOST_LINKS_STORAGE_KEY = "bb.rewriteLocalhostLinks";

export const REWRITE_LOCALHOST_LINKS_DEFAULT = true;

interface RewriteLocalhostLinkHrefArgs {
  currentHostname: string | undefined;
  enabled: boolean;
  href: string | undefined;
}

const LOOPBACK_LINK_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);
const IGNORED_REWRITE_HOSTNAME_PATTERNS = [
  /^(?:.+\.)?getbb\.app$/i,
];

function isIgnoredRewriteHostname(hostname: string): boolean {
  return IGNORED_REWRITE_HOSTNAME_PATTERNS.some((pattern) =>
    pattern.test(hostname),
  );
}

function isRewriteableLoopbackLink(url: URL): boolean {
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    LOOPBACK_LINK_HOSTNAMES.has(url.hostname.toLowerCase())
  );
}

export function rewriteLocalhostLinkHref({
  currentHostname,
  enabled,
  href,
}: RewriteLocalhostLinkHrefArgs): string | undefined {
  if (
    !enabled ||
    href === undefined ||
    currentHostname === undefined ||
    isIgnoredRewriteHostname(currentHostname)
  ) {
    return href;
  }

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }

  if (!isRewriteableLoopbackLink(url) || url.hostname === currentHostname) {
    return href;
  }

  url.hostname = currentHostname;
  return url.toString();
}
