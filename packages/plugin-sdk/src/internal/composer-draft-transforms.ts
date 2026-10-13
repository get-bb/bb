import type { ComposerDraft, ComposerMention } from "../app-contract.js";

export function removeComposerMentions<Draft extends ComposerDraft>(
  draft: Draft,
  matches: (mention: ComposerMention) => boolean,
): Draft {
  const removed = draft.mentions
    .filter(matches)
    .sort((a, b) => a.from - b.from);
  if (removed.length === 0) return draft;
  let text = "";
  let cursor = 0;
  for (const mention of removed) {
    text += draft.text.slice(cursor, mention.from);
    cursor = mention.to;
  }
  const removedSet = new Set(removed);
  const mentions = draft.mentions
    .filter((mention) => !removedSet.has(mention))
    .map((mention) => {
      const offset = removed.reduce(
        (sum, item) =>
          sum + (item.to <= mention.from ? item.to - item.from : 0),
        0,
      );
      return offset === 0
        ? mention
        : { ...mention, from: mention.from - offset, to: mention.to - offset };
    });
  return { ...draft, text: text + draft.text.slice(cursor), mentions };
}

export function setComposerText<Draft extends ComposerDraft>(
  draft: Draft,
  text: string,
): Draft {
  if (text === draft.text) return draft;
  return {
    ...draft,
    text,
    mentions: reconcileComposerMentions(draft.text, text, draft.mentions),
  };
}
export function reconcileComposerMentions(
  currentText: string,
  nextText: string,
  mentions: readonly ComposerMention[],
): ComposerMention[] {
  if (currentText === nextText) return [...mentions];

  let unchangedPrefixLength = 0;
  const maximumPrefixLength = Math.min(currentText.length, nextText.length);
  while (
    unchangedPrefixLength < maximumPrefixLength &&
    currentText[unchangedPrefixLength] === nextText[unchangedPrefixLength]
  ) {
    unchangedPrefixLength += 1;
  }

  let unchangedSuffixLength = 0;
  while (
    unchangedSuffixLength < currentText.length - unchangedPrefixLength &&
    unchangedSuffixLength < nextText.length - unchangedPrefixLength &&
    currentText[currentText.length - unchangedSuffixLength - 1] ===
      nextText[nextText.length - unchangedSuffixLength - 1]
  ) {
    unchangedSuffixLength += 1;
  }

  const replacedCurrentEnd = currentText.length - unchangedSuffixLength;
  const replacementDelta = nextText.length - currentText.length;
  return mentions.flatMap((mention) => {
    if (mention.to <= unchangedPrefixLength) return [mention];
    if (mention.from >= replacedCurrentEnd) {
      return [
        {
          ...mention,
          from: mention.from + replacementDelta,
          to: mention.to + replacementDelta,
        },
      ];
    }
    return [];
  });
}
