import type { GitHostPullRequest, ThreadPullRequest } from "@bb/domain";

/**
 * Server-owned product policy: fold the raw `gh` state plus `isDraft` from the
 * host daemon into the product-facing pull request state. An open PR marked as
 * a draft becomes `draft`; otherwise the open/merged/closed state carries over.
 */
export function assembleThreadPullRequest(
  raw: GitHostPullRequest | null,
): ThreadPullRequest | null {
  if (!raw) {
    return null;
  }
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state:
      raw.state === "MERGED"
        ? "merged"
        : raw.state === "CLOSED"
          ? "closed"
          : raw.isDraft
            ? "draft"
            : "open",
  };
}
