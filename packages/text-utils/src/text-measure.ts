const WORD_SEGMENTER_LOCALE = "en";

const WIDE_SCRIPT_PATTERN =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\p{Script=Yi}⺀-〾㈀-㏿︰-﹯！-｠￠-￦]/u;

const EMOJI_PLANE_FLOOR = 0x1f300;

let wordSegmenter: Intl.Segmenter | null = null;
let graphemeSegmenter: Intl.Segmenter | null = null;

function words(text: string): Intl.Segments {
  wordSegmenter ??= new Intl.Segmenter(WORD_SEGMENTER_LOCALE, {
    granularity: "word",
  });
  return wordSegmenter.segment(text);
}

function graphemes(text: string): Intl.Segments {
  graphemeSegmenter ??= new Intl.Segmenter(WORD_SEGMENTER_LOCALE, {
    granularity: "grapheme",
  });
  return graphemeSegmenter.segment(text);
}

function graphemeWidth(grapheme: string): number {
  const codePoint = grapheme.codePointAt(0);
  if (codePoint === undefined) {
    return 0;
  }
  if (codePoint >= EMOJI_PLANE_FLOOR) {
    return 2;
  }
  return WIDE_SCRIPT_PATTERN.test(grapheme) ? 2 : 1;
}

export function countWords(text: string): number {
  let count = 0;
  for (const segment of words(text)) {
    if (segment.isWordLike) {
      count += 1;
    }
  }
  return count;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const segment of graphemes(text)) {
    width += graphemeWidth(segment.segment);
  }
  return width;
}

export function truncateToWidth(text: string, maxWidth: number): string {
  let width = 0;
  let end = 0;
  for (const segment of graphemes(text)) {
    const next = width + graphemeWidth(segment.segment);
    if (next > maxWidth) {
      break;
    }
    width = next;
    end = segment.index + segment.segment.length;
  }
  return text.slice(0, end);
}

export function truncateToWidthAtWordBoundary(
  text: string,
  maxWidth: number,
): string {
  if (displayWidth(text) <= maxWidth) {
    return text;
  }

  let end = 0;
  for (const segment of words(text)) {
    if (!segment.isWordLike) {
      continue;
    }
    const candidateEnd = segment.index + segment.segment.length;
    if (displayWidth(text.slice(0, candidateEnd)) > maxWidth) {
      break;
    }
    end = candidateEnd;
  }

  return end > 0 ? text.slice(0, end) : truncateToWidth(text, maxWidth);
}
