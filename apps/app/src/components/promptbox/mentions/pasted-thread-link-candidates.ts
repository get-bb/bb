import type { ThreadLinkTarget } from "@/lib/thread-links";

export type ThreadLinkParser = (url: string) => ThreadLinkTarget | null;

export interface PastedThreadLink extends ThreadLinkTarget {
  from: number;
  to: number;
  text: string;
}

export function findPastedThreadLinkCandidates({
  text,
  parseLink,
  offset = 0,
  allowMarkdownSuffix = true,
}: {
  text: string;
  parseLink: ThreadLinkParser;
  offset?: number;
  allowMarkdownSuffix?: boolean;
}): PastedThreadLink[] {
  const links: PastedThreadLink[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/giu)) {
    const previous = text[match.index - 1];
    if (
      previous !== undefined &&
      /[\p{Letter}\p{Number}_/@\\=+%:.-]/u.test(previous)
    ) {
      continue;
    }
    const value = match[0].replace(
      allowMarkdownSuffix
        ? /[.,;:!)\]}*_~\u2019\u201d\u2026\u3002\uff0c\uff01\uff1b\uff1a\uff1f]+$/u
        : /[.,;:!)\]}\u2019\u201d\u2026\u3002\uff0c\uff01\uff1b\uff1a\uff1f]+$/u,
      "",
    );
    const identity = parseLink(value);
    if (identity === null) continue;
    links.push({
      from: offset + match.index,
      to: offset + match.index + value.length,
      text: value,
      threadId: identity.threadId,
      projectId: identity.projectId,
    });
  }
  return links;
}
