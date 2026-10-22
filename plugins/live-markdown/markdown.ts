interface TextRange {
  from: number;
  to: number;
}

export type MarkdownRangeKind =
  | "marker"
  | "bullet"
  | "ordered"
  | "h1"
  | "h2"
  | "h3"
  | "strong"
  | "em"
  | "code";

type MarkdownRanges = Record<MarkdownRangeKind, TextRange[]>;

const HEADING = /^(#{1,6})[ \t]+(?=\S)/;
const BULLET = /^([ \t]*)([-*+])([ \t]+)(?=\S)/;
const ORDERED = /^([ \t]*)(\d{1,9})([.)])([ \t]+)(?=\S)/;
const QUOTE = /^> ?/;
const CODE_SPAN = /(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g;
const FENCE_OPEN = /^[ \t]{0,3}(`{3,})[^`]*$/;
const FENCE_CLOSE = /^[ \t]{0,3}(`{3,})[ \t]*$/;
const MASK = "\uFFFC";
const INLINE_RULES: readonly {
  kind: "strong" | "em";
  delimiter: number;
  pattern: RegExp;
}[] = [
  {
    kind: "strong",
    delimiter: 2,
    pattern: /(?<![*\\])\*\*(?=\S)([^\n]*?[^\s\\])\*\*(?!\*)/g,
  },
  {
    kind: "strong",
    delimiter: 2,
    pattern: /(?<![_\w\\])__(?=\S)([^\n]*?[^\s\\])__(?![_\w])/g,
  },
  {
    kind: "em",
    delimiter: 1,
    pattern: /(?<![*\\])\*(?=[^\s*])([^*\n]*?[^\s*\\])\*(?!\*)/g,
  },
  {
    kind: "em",
    delimiter: 1,
    pattern: /(?<![_\w\\])_(?=[^\s_])([^_\n]*?[^\s_\\])_(?![_\w])/g,
  },
];

function emptyRanges(): MarkdownRanges {
  return {
    marker: [],
    bullet: [],
    ordered: [],
    h1: [],
    h2: [],
    h3: [],
    strong: [],
    em: [],
    code: [],
  };
}

function mask(line: string, from: number, to: number): string {
  return line.slice(0, from) + MASK.repeat(to - from) + line.slice(to);
}

function parseInline(
  line: string,
  lineStart: number,
  ranges: MarkdownRanges,
): void {
  let masked = line;

  for (const match of line.matchAll(CODE_SPAN)) {
    const run = match[1]!.length;
    const from = lineStart + match.index;
    const to = from + match[0].length;
    ranges.marker.push({ from, to: from + run }, { from: to - run, to });
    ranges.code.push({ from: from + run, to: to - run });
    masked = mask(masked, match.index, match.index + match[0].length);
  }

  for (const rule of INLINE_RULES) {
    const delimiters: TextRange[] = [];
    for (const match of masked.matchAll(rule.pattern)) {
      const from = lineStart + match.index;
      const to = from + match[0].length;
      const content = { from: from + rule.delimiter, to: to - rule.delimiter };
      ranges.marker.push({ from, to: content.from }, { from: content.to, to });
      ranges[rule.kind].push(content);
      delimiters.push(
        { from: match.index, to: match.index + rule.delimiter },
        {
          from: match.index + match[0].length - rule.delimiter,
          to: match.index + match[0].length,
        },
      );
    }
    for (const delimiter of delimiters) {
      masked = mask(masked, delimiter.from, delimiter.to);
    }
  }
}

function parseLine(
  line: string,
  lineStart: number,
  ranges: MarkdownRanges,
): void {
  const quote = QUOTE.exec(line);
  const bodyOffset = quote === null ? 0 : quote[0].length;
  const body = line.slice(bodyOffset);
  const bodyStart = lineStart + bodyOffset;

  let contentOffset = 0;
  const heading = HEADING.exec(body);
  const bullet = heading === null ? BULLET.exec(body) : null;
  const ordered =
    heading === null && bullet === null ? ORDERED.exec(body) : null;
  if (heading !== null) {
    contentOffset = heading[0].length;
    ranges.marker.push({ from: bodyStart, to: bodyStart + contentOffset });
    const level = Math.min(heading[1]!.length, 3);
    ranges[`h${level}` as "h1" | "h2" | "h3"].push({
      from: bodyStart + contentOffset,
      to: lineStart + line.length,
    });
  } else if (bullet !== null) {
    contentOffset = bullet[0].length;
    ranges.bullet.push({
      from: bodyStart + bullet[1]!.length,
      to: bodyStart + contentOffset,
    });
  } else if (ordered !== null) {
    contentOffset = ordered[0].length;
    const markerStart = bodyStart + ordered[1]!.length;
    ranges.ordered.push({
      from: markerStart,
      to: markerStart + ordered[2]!.length + ordered[3]!.length,
    });
  }

  parseInline(body.slice(contentOffset), bodyStart + contentOffset, ranges);
}

export function parseMarkdownRanges(text: string): MarkdownRanges {
  const ranges = emptyRanges();
  let lineStart = 0;
  let fence: number | null = null;
  for (const line of text.split("\n")) {
    if (fence === null) {
      const open = FENCE_OPEN.exec(line);
      if (open === null) parseLine(line, lineStart, ranges);
      else fence = open[1]!.length;
    } else {
      const close = FENCE_CLOSE.exec(line);
      if (close !== null && close[1]!.length >= fence) fence = null;
    }
    lineStart += line.length + 1;
  }
  return ranges;
}

let cachedText: string | null = null;
let cachedRanges: MarkdownRanges = emptyRanges();

export function markdownRanges(text: string): MarkdownRanges {
  if (cachedText !== text) {
    cachedText = text;
    cachedRanges = parseMarkdownRanges(text);
  }
  return cachedRanges;
}
