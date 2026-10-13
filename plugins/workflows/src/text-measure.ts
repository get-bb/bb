const WIDE_SCRIPT_PATTERN =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\p{Script=Yi}⺀-〾㈀-㏿︰-﹯！-｠￠-￦]/u;

const EMOJI_PATTERN =
  /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F|[#*0-9]\uFE0F?\u20E3)/u;
const graphemeSegmenter = new Intl.Segmenter("en", {
  granularity: "grapheme",
});

function graphemeWidth(grapheme: string): number {
  if (grapheme.length === 0) return 0;
  if (EMOJI_PATTERN.test(grapheme)) return 2;
  return WIDE_SCRIPT_PATTERN.test(grapheme) ? 2 : 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const segment of graphemeSegmenter.segment(text)) {
    width += graphemeWidth(segment.segment);
  }
  return width;
}

export function truncateToWidth(text: string, maxWidth: number): string {
  let width = 0;
  let end = 0;
  for (const segment of graphemeSegmenter.segment(text)) {
    const next = width + graphemeWidth(segment.segment);
    if (next > maxWidth) break;
    width = next;
    end = segment.index + segment.segment.length;
  }
  return text.slice(0, end);
}
