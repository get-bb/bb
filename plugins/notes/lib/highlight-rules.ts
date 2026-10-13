import { fencedCodeLines } from "./fenced-code.js";
import {
  DEFAULT_REGEX_FLAGS,
  type DecorationStyle,
  type NotesSettings,
} from "./vscode-settings.js";

/**
 * A `highlight.regexes` entry compiled for one open document.
 *
 * `groups[i]` is the style for capture group `i + 1`, which is how the VS
 * Code Highlight extension pairs its `decorations` array to the pattern: the
 * first decoration styles the first capture group, not the whole match. A
 * pattern with no capture groups at all falls back to group 0 so a
 * group-less rule still highlights something.
 */
export interface CompiledHighlightRule {
  regex: RegExp;
  groups: readonly (DecorationStyle | undefined)[];
  /** True when the pattern has no capture groups and `groups[0]` is group 0. */
  wholeMatch: boolean;
  /**
   * Skip lines inside a fenced code block.
   *
   * Set for the built-in Markdown rules, where a `# comment` in a shell
   * block is not a heading. Left off for the user's own rules: VS Code's
   * Highlight extension does mark a TODO inside code, and that is the point
   * of the imported TODO and FIXME patterns.
   */
  skipFencedCode: boolean;
}

export interface HighlightRange {
  lineNumber: number;
  /** 1-based, Monaco column convention. */
  startColumn: number;
  endColumn: number;
  style: DecorationStyle;
}

export interface DocumentIdentity {
  /** Path the rule's `filterFileRegex` is tested against. */
  path: string;
  /** Language id the rule's `filterLanguageRegex` is tested against. */
  languageId: string;
}

/**
 * Lines longer than this are skipped. The imported TODO and FIXME patterns
 * carry nested optional groups whose backtracking is superlinear, and a
 * single pasted minified blob in a note would otherwise stall the editor on
 * every keystroke.
 */
const MAX_SCANNED_LINE_LENGTH = 2000;

/** Bounds total work for a pathological document rather than the UI. */
const MAX_RANGES = 5000;

/** Bounds a single rule that matches almost everywhere on a line. */
const MAX_MATCHES_PER_LINE = 200;

function countCaptureGroups(source: string): number {
  // Appending `|` makes the pattern match the empty string, so one exec
  // reports the group count without needing to parse the pattern.
  try {
    const probe = new RegExp(`${source}|`);
    const match = probe.exec("");
    return match === null ? 0 : match.length - 1;
  } catch {
    return 0;
  }
}

/**
 * Forces the flags a per-line scan needs: `g` to walk every match on the
 * line and `d` to learn where each capture group starts and ends. `i` and
 * the rest come from the rule or the VS Code default.
 */
function scanFlags(requested: string): string {
  const kept = new Set(
    [...requested].filter((flag) => "imsu".includes(flag)),
  );
  return `${[...kept].join("")}gd`;
}

function safeRegExp(source: string, flags: string): RegExp | null {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

function matchesFilter(
  pattern: string | undefined,
  value: string,
): boolean {
  if (pattern === undefined) return true;
  const regex = safeRegExp(pattern, "");
  // An unparseable filter should not silently widen the rule to every file.
  if (regex === null) return false;
  return regex.test(value);
}

export interface CompileOptions {
  /** See `CompiledHighlightRule.skipFencedCode`. */
  skipFencedCode?: boolean;
}

export function compileHighlightRules(
  settings: NotesSettings,
  document: DocumentIdentity,
  options: CompileOptions = {},
): CompiledHighlightRule[] {
  const configured = settings["highlight.regexes"];
  if (configured === undefined) return [];
  const fallbackFlags = settings["highlight.regexFlags"] ?? DEFAULT_REGEX_FLAGS;

  const compiled: CompiledHighlightRule[] = [];
  for (const [source, rule] of Object.entries(configured)) {
    if (!matchesFilter(rule.filterFileRegex, document.path)) continue;
    if (!matchesFilter(rule.filterLanguageRegex, document.languageId)) continue;
    if (rule.decorations.length === 0) continue;

    const regex = safeRegExp(
      source,
      scanFlags(rule.regexFlags ?? fallbackFlags),
    );
    if (regex === null) continue;

    const captureCount = countCaptureGroups(source);
    compiled.push({
      regex,
      groups: rule.decorations,
      wholeMatch: captureCount === 0,
      skipFencedCode: options.skipFencedCode === true,
    });
  }
  return compiled;
}

/**
 * Scans line by line rather than over the whole document.
 *
 * Every imported rule is line-oriented — they exclude `\r` and `\n`
 * explicitly — so per-line scanning finds the same matches while keeping each
 * regex run short, which is what makes the superlinear TODO pattern safe to
 * re-run on every edit.
 */
export function findHighlightRanges(
  rules: readonly CompiledHighlightRule[],
  lines: readonly string[],
): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  if (rules.length === 0) return ranges;

  // Only paid for when some rule actually cares about fences.
  const fenced = rules.some((rule) => rule.skipFencedCode)
    ? fencedCodeLines(lines)
    : null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || line.length > MAX_SCANNED_LINE_LENGTH) continue;
    const lineNumber = index + 1;
    const insideFence = fenced?.has(lineNumber) === true;

    for (const rule of rules) {
      if (rule.skipFencedCode && insideFence) continue;
      rule.regex.lastIndex = 0;
      let matches = 0;
      let match: RegExpExecArray | null;

      while ((match = rule.regex.exec(line)) !== null) {
        matches += 1;
        if (matches > MAX_MATCHES_PER_LINE) break;

        const indices = match.indices;
        for (
          let position = 0;
          position < rule.groups.length;
          position += 1
        ) {
          const style = rule.groups[position];
          if (style === undefined) continue;
          const group = rule.wholeMatch ? 0 : position + 1;
          const span = indices?.[group];
          if (span === undefined) continue;
          const [start, end] = span;
          if (end <= start) continue;
          ranges.push({
            lineNumber,
            startColumn: start + 1,
            endColumn: end + 1,
            style,
          });
          if (ranges.length >= MAX_RANGES) return ranges;
        }

        // A pattern able to match empty — several imported ones end in an
        // all-optional group — would otherwise spin on one position.
        if (match.index === rule.regex.lastIndex) {
          rule.regex.lastIndex += 1;
        }
      }
    }
  }

  return ranges;
}
