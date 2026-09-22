import { rewriteLocalhostLinkHref } from "@bb/client-core";

const EXAMPLE_HREF = "http://localhost:3000/";

export function localhostLinkRewriteDescription(
  currentHostname: string | undefined,
): string | null {
  if (currentHostname === undefined) {
    return null;
  }

  const rewrittenHref = rewriteLocalhostLinkHref({
    currentHostname,
    enabled: true,
    href: EXAMPLE_HREF,
  });
  if (rewrittenHref === EXAMPLE_HREF) {
    return null;
  }

  return `When enabled, localhost URLs are rewritten to use the same host or IP address you use to open BB. For example: ${EXAMPLE_HREF} → ${rewrittenHref}`;
}
