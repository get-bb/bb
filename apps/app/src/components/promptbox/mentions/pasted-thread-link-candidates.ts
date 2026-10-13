import {
  GENERATED_ID_ALPHABET,
  GENERATED_ID_SUFFIX_LENGTH,
  isRawThreadId,
} from "@bb/domain";

export interface PastedThreadLink {
  from: number;
  to: number;
  text: string;
  threadId: string;
  projectId: string | null;
}

const threadPathPattern = new RegExp(
  `^/(?:projects/(proj_[${GENERATED_ID_ALPHABET}]{${GENERATED_ID_SUFFIX_LENGTH}})/)?threads/([^/]+)/?$`,
  "u",
);

function parseThreadLink(
  text: string,
  origin: string,
): Pick<PastedThreadLink, "threadId" | "projectId"> | null {
  const parts = /^https?:\/\/([^/]+)(\/[^?#]*)$/iu.exec(text);
  if (parts === null || /[@\\]/u.test(parts[1]!)) return null;
  const path = threadPathPattern.exec(parts[2]!);
  if (path === null || !isRawThreadId(path[2]!)) return null;

  try {
    if (new URL(text).origin !== origin) return null;
  } catch {
    return null;
  }

  return { threadId: path[2]!, projectId: path[1] ?? null };
}

export function findPastedThreadLinkCandidates({
  text,
  origin,
  offset = 0,
  allowMarkdownSuffix = true,
}: {
  text: string;
  origin: string;
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
    const identity = parseThreadLink(value, origin);
    if (identity === null) continue;
    links.push({
      from: offset + match.index,
      to: offset + match.index + value.length,
      text: value,
      ...identity,
    });
  }
  return links;
}
