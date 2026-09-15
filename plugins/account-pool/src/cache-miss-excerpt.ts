export interface ExcerptSplit {
  unchanged: string;
  before: string | null;
  after: string | null;
}

const ESCAPED_CHARACTER = /\\(["\\/nt])/gu;

export function firstDifference(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left.charCodeAt(index) === right.charCodeAt(index))
    index += 1;
  return index;
}

export function splitExcerpts(
  before: string | null,
  after: string | null,
): ExcerptSplit {
  if (before === null || after === null)
    return { unchanged: "", before, after };
  const difference = firstDifference(before, after);
  const split = pairStart(
    before,
    Math.min(escapeStart(before, difference), escapeStart(after, difference)),
  );
  return {
    unchanged: before.slice(0, split),
    before: before.slice(split),
    after: after.slice(split),
  };
}

export function readableExcerpt(text: string): string {
  return text.replace(ESCAPED_CHARACTER, (_sequence, escaped: string) =>
    escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped,
  );
}

export function escapeStart(text: string, index: number): number {
  const start = text.lastIndexOf("\\", index - 1);
  if (start < 0 || start >= index || index - start > 5) return index;
  let preceding = 0;
  while (start - preceding > 0 && text[start - preceding - 1] === "\\")
    preceding += 1;
  if (preceding % 2 === 1) return index;
  return start + escapeLength(text, start) > index ? start : index;
}

export function escapeEnd(text: string, index: number): number {
  const start = escapeStart(text, index);
  return start === index ? index : start + escapeLength(text, start);
}

function escapeLength(text: string, start: number): number {
  return text[start + 1] === "u" ? 6 : 2;
}

function pairStart(text: string, index: number): number {
  if (index === 0) return index;
  const code = text.charCodeAt(index - 1);
  return code >= 0xd800 && code <= 0xdbff ? index - 1 : index;
}
