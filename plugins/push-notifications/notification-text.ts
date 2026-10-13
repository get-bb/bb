const REFERENCED_TITLE_MAX_LENGTH = 40;
const CODE_FENCE_PATTERN = /^\s*(```|~~~)/u;
const BREAK_PATTERN = /^\s{0,3}(?:#{1,6}(?:\s|$)|([-*_])(?:\s*\1){2,}\s*$)/u;
const BLOCK_MARKER_PATTERN = /^\s{0,3}(?:>\s?|[-*+]\s+|\d+[.)]\s+)/u;
const THREAD_REFERENCE_PATTERN =
  /@thread:([A-Za-z0-9_-]+)(?:#msg=\d+)?|\bthr_[23456789abcdefghijkmnpqrstuvwxyz]{10}\b/gu;

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function firstParagraph(markdown: string): string {
  const lines: string[] = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/u)) {
    if (CODE_FENCE_PATTERN.test(line)) {
      inFence = !inFence;
      if (lines.length > 0) break;
      continue;
    }
    if (inFence) continue;
    if (BREAK_PATTERN.test(line)) {
      if (lines.length > 0) break;
      continue;
    }
    const text = line.replace(BLOCK_MARKER_PATTERN, "").trim();
    if (text.length === 0) {
      if (lines.length > 0) break;
      continue;
    }
    lines.push(text);
  }
  return lines.join(" ");
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<(https?:\/\/[^>\s]+)>/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/(\*\*|__)(.+?)\1/gu, "$2")
    .replace(/~~(.+?)~~/gu, "$1")
    .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?![*\w])/gu, "$1$2")
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/gu, "$1");
}

export async function notificationPreviewText(
  markdown: string,
  threadTitle: (threadId: string) => Promise<string | null>,
): Promise<string> {
  const text = stripInlineMarkdown(firstParagraph(markdown));
  const references = [...text.matchAll(THREAD_REFERENCE_PATTERN)];
  if (references.length === 0) return text;
  const threadIds = new Set(references.map((match) => match[1] ?? match[0]));
  const titles = new Map(
    await Promise.all(
      [...threadIds].map(
        async (threadId) => [threadId, await threadTitle(threadId)] as const,
      ),
    ),
  );
  return text.replace(
    THREAD_REFERENCE_PATTERN,
    (match, mentionId: string | undefined) => {
      const title = titles.get(mentionId ?? match);
      return title
        ? `“${truncate(title, REFERENCED_TITLE_MAX_LENGTH)}”`
        : match;
    },
  );
}
