const THINK_BLOCK = /<think(?:ing)?>[\s\S]*?(?:<\/think(?:ing)?>|$)/giu;
const CODE_FENCE_LINE = /^```[\w-]*$/u;
const CALL_WRAPPER = /^result\((?:\s*\w+\s*=)?\s*([\s\S]*?)\s*\)$/iu;
const TAG_WRAPPER = /^<([a-z_-]+)>([\s\S]*)<\/\1>$/iu;
const LEADING_LABEL =
  /^(?:title|thread title|commit message|commit|message|subject|transcript)\s*:\s*/iu;
const LEAD_IN = /:$/u;
const WRAPPING_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
  ["“", "”"],
  ["‘", "’"],
  ["**", "**"],
  ["*", "*"],
];

function stripWrapping(value: string): string {
  let current = value;
  for (;;) {
    const call = CALL_WRAPPER.exec(current);
    if (call?.[1] !== undefined) {
      current = call[1].trim();
      continue;
    }
    const tag = TAG_WRAPPER.exec(current);
    if (tag?.[2] !== undefined) {
      current = tag[2].trim();
      continue;
    }
    const pair = WRAPPING_PAIRS.find(
      ([open, close]) =>
        current.length >= open.length + close.length &&
        current.startsWith(open) &&
        current.endsWith(close),
    );
    if (pair === undefined) return current;
    current = current.slice(pair[0].length, -pair[1].length).trim();
  }
}

function cleanLine(line: string): string {
  return stripWrapping(
    stripWrapping(line.replace(/^[-*]\s+/u, "")).replace(LEADING_LABEL, ""),
  ).trim();
}

export function cleanGeneratedLine(raw: string): string | null {
  for (const line of raw.replace(THINK_BLOCK, "").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || CODE_FENCE_LINE.test(trimmed)) continue;
    const cleaned = cleanLine(trimmed);
    if (cleaned.length > 0 && !LEAD_IN.test(cleaned)) return cleaned;
  }
  return null;
}
