const WIDE_SCRIPT_PATTERN =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\p{Script=Yi}⺀-〾㈀-㏿︰-﹯！-｠￠-￦]/u;

const EMOJI_PLANE_FLOOR = 0x1f300;
const graphemeSegmenter = new Intl.Segmenter("en", {
  granularity: "grapheme",
});

function graphemeWidth(grapheme: string): number {
  const codePoint = grapheme.codePointAt(0);
  if (codePoint === undefined) return 0;
  if (codePoint >= EMOJI_PLANE_FLOOR) return 2;
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
