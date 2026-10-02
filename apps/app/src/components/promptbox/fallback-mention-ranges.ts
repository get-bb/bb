import type { PromptTextMention } from "@bb/domain";

export function fallbackMentionRanges(
  previousText: string,
  nextText: string,
  mentionRanges: readonly PromptTextMention[],
): PromptTextMention[] {
  if (mentionRanges.length === 0) return [];
  let prefix = 0;
  const maxPrefix = Math.min(previousText.length, nextText.length);
  while (prefix < maxPrefix && previousText[prefix] === nextText[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  const maxSuffix = maxPrefix - prefix;
  while (
    suffix < maxSuffix &&
    previousText[previousText.length - 1 - suffix] ===
      nextText[nextText.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const delta = nextText.length - previousText.length;
  const editedFrom = previousText.length - suffix;
  const kept: PromptTextMention[] = [];
  for (const range of mentionRanges) {
    if (range.end <= prefix) {
      kept.push(range);
    } else if (range.start >= editedFrom) {
      kept.push({
        ...range,
        start: range.start + delta,
        end: range.end + delta,
      });
    }
  }
  return kept;
}
