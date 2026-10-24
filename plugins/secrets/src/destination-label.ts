export interface DestinationParts {
  stem: string;
  extension: string;
  folder: string | null;
}

const DRIVE = /^[A-Za-z]:$/;
const DOTENV_SUFFIX = /\.env(\.[^.]+){0,2}$/;

function lastSeparator(path: string): number {
  return Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
}

export function splitDestination(path: string): DestinationParts {
  const separator = lastSeparator(path);
  const name = path.slice(separator + 1);
  if (!name) return { stem: path, extension: "", folder: null };
  const dotenv = DOTENV_SUFFIX.exec(name);
  const dot =
    dotenv === null
      ? name.lastIndexOf(".")
      : dotenv.index > 0
        ? dotenv.index
        : ".env".length;
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  if (separator < 0) return { stem, extension, folder: null };
  const folder = path.slice(0, separator) || path.slice(0, 1);
  return {
    stem,
    extension,
    folder: DRIVE.test(folder) ? `${folder}${path[separator]}` : folder,
  };
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function graphemes(text: string): string[] {
  return Array.from(GRAPHEMES.segment(text), ({ segment }) => segment);
}

export function graphemeCount(text: string): number {
  return graphemes(text).length;
}

export function rightmostSpan(
  boxes: readonly { left: number; right: number }[],
  count: number,
): number | null {
  const rightmost = boxes
    .filter((box) => box.right > box.left)
    .sort((a, b) => b.right - a.right)
    .slice(0, count);
  if (rightmost.length === 0) return null;
  return (
    Math.max(...rightmost.map((box) => box.right)) -
    Math.min(...rightmost.map((box) => box.left))
  );
}

export function fitStem(
  stem: string,
  available: number,
  width: (text: string) => number,
): string {
  const whole = width(stem);
  if (whole <= available) return stem;
  const characters = graphemes(stem);
  if (characters.length < 3) return stem;
  for (let kept = characters.length - 1; kept > 2; kept -= 1) {
    const head = Math.ceil(kept / 2);
    const text = `${characters.slice(0, head).join("")}…${characters.slice(head - kept).join("")}`;
    if (width(text) <= available) return text;
  }
  const shortest = `${characters[0]}…${characters[characters.length - 1]}`;
  return width(shortest) < whole ? shortest : stem;
}

export function displayPath(path: string): string {
  return `\u2066${path.replace(/[\\/]/g, "$&\u200e")}\u2069`;
}
