import type { ThreadSearchHighlightRange } from "@bb/server-contract";

const THREAD_SEARCH_WINDOW_LEAD_CHARS = 16;
const THREAD_SEARCH_WINDOW_TAIL_CHARS = 40;
const THREAD_SEARCH_WINDOW_ELLIPSIS = "…";

export interface WindowPaletteThreadSearchTextArgs {
  text: string;
  highlightRanges: readonly ThreadSearchHighlightRange[];
}

export interface WindowedPaletteThreadSearchText {
  text: string;
  highlightRanges: ThreadSearchHighlightRange[];
}

function isHighSurrogate(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff;
}

function isInsideSurrogatePair(text: string, index: number): boolean {
  return (
    index > 0 &&
    index < text.length &&
    isHighSurrogate(text, index - 1) &&
    isLowSurrogate(text, index)
  );
}

function clampInteger(value: number, maximum: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(Math.trunc(value), maximum));
}

function normalizeHighlightRanges(
  text: string,
  ranges: readonly ThreadSearchHighlightRange[],
): ThreadSearchHighlightRange[] {
  const normalized: ThreadSearchHighlightRange[] = [];

  for (const range of ranges) {
    let start = clampInteger(range.start, text.length);
    let end = clampInteger(range.end, text.length);
    if (start === null || end === null || end <= start) {
      continue;
    }

    if (isInsideSurrogatePair(text, start)) {
      start -= 1;
    }
    if (isInsideSurrogatePair(text, end)) {
      end += 1;
    }

    normalized.push({ start, end });
  }

  normalized.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );

  const merged: ThreadSearchHighlightRange[] = [];
  for (const range of normalized) {
    const previous = merged.at(-1);
    if (previous !== undefined && range.start < previous.end) {
      previous.end = Math.max(previous.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

function moveStartToWordBoundary(
  text: string,
  start: number,
  firstMatchStart: number,
): number {
  if (start === 0) {
    return start;
  }
  const firstWhitespace = text.slice(start, firstMatchStart).search(/\s/u);
  if (firstWhitespace === -1) {
    return start;
  }

  let boundary = start + firstWhitespace + 1;
  while (boundary < firstMatchStart && /\s/u.test(text[boundary] ?? "")) {
    boundary += 1;
  }
  return boundary;
}

function moveEndToWordBoundary(
  text: string,
  firstMatchEnd: number,
  end: number,
): number {
  if (end === text.length) {
    return end;
  }
  const lastWhitespace = text
    .slice(firstMatchEnd, end)
    .search(/\s\S*$/u);
  return lastWhitespace > 0 ? firstMatchEnd + lastWhitespace : end;
}

export function windowPaletteThreadSearchText({
  text,
  highlightRanges,
}: WindowPaletteThreadSearchTextArgs): WindowedPaletteThreadSearchText {
  const normalizedRanges = normalizeHighlightRanges(text, highlightRanges);
  const firstMatch = normalizedRanges[0];
  if (firstMatch === undefined) {
    return { text, highlightRanges: [] };
  }

  let start = Math.max(
    0,
    firstMatch.start - THREAD_SEARCH_WINDOW_LEAD_CHARS,
  );
  let end = Math.min(
    text.length,
    firstMatch.end + THREAD_SEARCH_WINDOW_TAIL_CHARS,
  );

  start = moveStartToWordBoundary(text, start, firstMatch.start);
  end = moveEndToWordBoundary(text, firstMatch.end, end);

  if (isInsideSurrogatePair(text, start)) {
    start += 1;
  }
  if (isInsideSurrogatePair(text, end)) {
    end -= 1;
  }

  const prefix = start > 0 ? THREAD_SEARCH_WINDOW_ELLIPSIS : "";
  const suffix = end < text.length ? THREAD_SEARCH_WINDOW_ELLIPSIS : "";
  const rebasedRanges: ThreadSearchHighlightRange[] = [];

  for (const range of normalizedRanges) {
    const rangeStart = Math.max(range.start, start);
    const rangeEnd = Math.min(range.end, end);
    if (rangeEnd <= rangeStart) {
      continue;
    }
    rebasedRanges.push({
      start: rangeStart - start + prefix.length,
      end: rangeEnd - start + prefix.length,
    });
  }

  return {
    text: `${prefix}${text.slice(start, end)}${suffix}`,
    highlightRanges: rebasedRanges,
  };
}
