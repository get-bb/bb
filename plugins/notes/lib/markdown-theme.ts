import type * as MonacoNs from "monaco-editor";
import type { PluginCodeThemeData } from "@get-bb/plugin-sdk/app";

const TOKEN_COLOR = /^#?([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/;
const WORKBENCH_COLOR = /^#([0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

/**
 * Monaco's Markdown Monarch grammar tags every construct with a handful of
 * generic token names and the `.md` postfix: a heading, a list bullet and a
 * table divider are all `keyword.md`; inline code is `variable.md`; a
 * blockquote shares `comment.md` with an HTML comment.
 *
 * Those names carry no Markdown meaning, so a code theme built for
 * TextMate scopes colours them as if they were code — headings pick up the
 * keyword colour used for `if` and `return`. This table re-points each one
 * at the `markup.*` scopes a theme defines for *prose*, so a note is
 * coloured as a document instead of as source.
 */
interface MarkdownTokenMapping {
  /** Monaco Monarch token, matched by prefix. */
  token: string;
  /** TextMate scopes to borrow a colour from, best first. */
  scopes: readonly string[];
  fontStyle?: string;
  /** Used when the theme defines none of `scopes`. */
  fallback: { light: string; dark: string };
}

const MARKDOWN_TOKENS: readonly MarkdownTokenMapping[] = [
  {
    // Headings, list bullets, setext underlines and table dividers.
    token: "keyword.md",
    scopes: ["markup.heading", "entity.name.section", "markup.bold"],
    fontStyle: "bold",
    fallback: { light: "#0550ae", dark: "#79c0ff" },
  },
  {
    token: "strong.md",
    scopes: ["markup.bold", "markup.heading"],
    fontStyle: "bold",
    fallback: { light: "#953800", dark: "#ffa657" },
  },
  {
    token: "emphasis.md",
    scopes: ["markup.italic", "markup.quote"],
    fontStyle: "italic",
    fallback: { light: "#6639ba", dark: "#d2a8ff" },
  },
  {
    // Inline code spans.
    token: "variable.md",
    scopes: ["markup.inline.raw", "markup.raw", "string"],
    fallback: { light: "#0a3069", dark: "#a5d6ff" },
  },
  {
    // Body of a fenced or indented code block.
    token: "variable.source.md",
    scopes: ["markup.fenced_code.block", "markup.raw", "string"],
    fallback: { light: "#0a3069", dark: "#a5d6ff" },
  },
  {
    // The ``` and ~~~ fences themselves, and indented code blocks.
    token: "string.md",
    scopes: ["punctuation.definition.markdown", "comment", "markup.raw"],
    fallback: { light: "#6e7781", dark: "#8b949e" },
  },
  {
    token: "string.link.md",
    scopes: ["markup.underline.link", "string.other.link", "entity.name.tag"],
    fallback: { light: "#0969da", dark: "#a5d6ff" },
  },
  {
    // Blockquotes, and HTML comments.
    token: "comment.md",
    scopes: ["markup.quote", "comment"],
    fontStyle: "italic",
    fallback: { light: "#6e7781", dark: "#8b949e" },
  },
  {
    // Thematic breaks written as `***`.
    token: "meta.separator.md",
    scopes: ["meta.separator", "comment"],
    fallback: { light: "#6e7781", dark: "#8b949e" },
  },
  {
    token: "keyword.table.header.md",
    scopes: ["markup.bold", "markup.heading"],
    fontStyle: "bold",
    fallback: { light: "#24292f", dark: "#e6edf3" },
  },
  {
    // The pipes between cells. Deliberately dim: they are scaffolding.
    token: "keyword.table",
    scopes: ["punctuation.definition.markdown", "comment"],
    fallback: { light: "#8c959f", dark: "#6e7681" },
  },
  {
    token: "tag.md",
    scopes: ["entity.name.tag", "support.type"],
    fallback: { light: "#116329", dark: "#7ee787" },
  },
  {
    token: "attribute.name.html.md",
    scopes: ["entity.other.attribute-name", "variable"],
    fallback: { light: "#953800", dark: "#ffa657" },
  },
  {
    token: "string.html.md",
    scopes: ["string.quoted", "string"],
    fallback: { light: "#0a3069", dark: "#a5d6ff" },
  },
  {
    token: "string.escape.md",
    scopes: ["constant.character.escape", "constant"],
    fallback: { light: "#0550ae", dark: "#79c0ff" },
  },
];

function normalizeTokenColor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const hex = value.startsWith("#") ? value.slice(1) : value;
  const expanded =
    hex.length === 3 || hex.length === 4
      ? hex
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : hex;
  return TOKEN_COLOR.test(expanded) ? expanded : undefined;
}

function fontStyleFor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const styles = value
    .split(/\s+/)
    .filter(
      (style) =>
        style === "italic" || style === "bold" || style === "underline",
    );
  return styles.length === 0 ? undefined : styles.join(" ");
}

function scopeList(scope: string | readonly string[] | undefined): string[] {
  if (scope === undefined) return [""];
  return typeof scope === "string" ? scope.split(",") : [...scope];
}

/**
 * Finds the colour a theme gives the first of `scopes` it defines.
 *
 * Matching is by prefix in both directions so `markup.heading` is satisfied
 * by a theme that only declares `markup.heading.markdown`, and vice versa —
 * themes disagree about how specific these scope names should be.
 */
export function colorForScopes(
  theme: PluginCodeThemeData,
  scopes: readonly string[],
): string | undefined {
  for (const wanted of scopes) {
    for (const rule of theme.tokenColors) {
      const foreground = normalizeTokenColor(rule.settings.foreground);
      if (foreground === undefined) continue;
      for (const raw of scopeList(rule.scope)) {
        const declared = raw.trim();
        if (declared === "") continue;
        if (declared === wanted) return foreground;
        if (declared.startsWith(`${wanted}.`)) return foreground;
        if (wanted.startsWith(`${declared}.`)) return foreground;
      }
    }
  }
  return undefined;
}

function baseTokenRules(
  theme: PluginCodeThemeData,
): MonacoNs.editor.ITokenThemeRule[] {
  const rules: MonacoNs.editor.ITokenThemeRule[] = [];
  const base = normalizeTokenColor(theme.fg);
  if (base !== undefined) rules.push({ token: "", foreground: base });
  for (const rule of theme.tokenColors) {
    const foreground = normalizeTokenColor(rule.settings.foreground);
    const background = normalizeTokenColor(rule.settings.background);
    const fontStyle = fontStyleFor(rule.settings.fontStyle);
    if (
      foreground === undefined &&
      background === undefined &&
      fontStyle === undefined
    ) {
      continue;
    }
    for (const raw of scopeList(rule.scope)) {
      const token = raw.trim();
      if (rule.scope !== undefined && token === "") continue;
      rules.push({
        token,
        ...(foreground === undefined ? {} : { foreground }),
        ...(background === undefined ? {} : { background }),
        ...(fontStyle === undefined ? {} : { fontStyle }),
      });
    }
  }
  return rules;
}

/**
 * The Markdown rules, appended after the theme's own so they win: Monaco
 * resolves a token against the last matching rule.
 */
export function markdownTokenRules(
  theme: PluginCodeThemeData,
): MonacoNs.editor.ITokenThemeRule[] {
  return MARKDOWN_TOKENS.map((mapping) => {
    const foreground =
      colorForScopes(theme, mapping.scopes) ??
      normalizeTokenColor(
        theme.type === "light"
          ? mapping.fallback.light
          : mapping.fallback.dark,
      );
    const fontStyle = fontStyleFor(mapping.fontStyle);
    return {
      token: mapping.token,
      ...(foreground === undefined ? {} : { foreground }),
      ...(fontStyle === undefined ? {} : { fontStyle }),
    };
  });
}

export function workbenchColors(
  theme: PluginCodeThemeData,
): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const [id, value] of Object.entries(theme.colors)) {
    if (typeof value === "string" && WORKBENCH_COLOR.test(value)) {
      colors[id] = value;
    }
  }
  if (
    colors["editor.background"] === undefined &&
    WORKBENCH_COLOR.test(theme.bg)
  ) {
    colors["editor.background"] = theme.bg;
  }
  if (
    colors["editor.foreground"] === undefined &&
    WORKBENCH_COLOR.test(theme.fg)
  ) {
    colors["editor.foreground"] = theme.fg;
  }
  return colors;
}

export function editorBackground(
  theme: PluginCodeThemeData | null,
): string | null {
  if (theme === null) return null;
  return workbenchColors(theme)["editor.background"] ?? null;
}

export function notesThemeName(name: string): string {
  return `bb-notes-${name.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}

export function toMarkdownMonacoTheme(
  theme: PluginCodeThemeData,
): MonacoNs.editor.IStandaloneThemeData {
  return {
    base: theme.type === "light" ? "vs" : "vs-dark",
    inherit: true,
    rules: [...baseTokenRules(theme), ...markdownTokenRules(theme)],
    colors: workbenchColors(theme),
  };
}

export interface AppliedTheme {
  name: string;
  base: "vs" | "vs-dark";
  colors: Readonly<Record<string, string>>;
}

export function applyMarkdownTheme(
  monaco: typeof MonacoNs,
  state: { mode: "light" | "dark"; theme: PluginCodeThemeData | null },
): AppliedTheme {
  if (state.theme === null) {
    const base = state.mode === "dark" ? "vs-dark" : "vs";
    return { name: base, base, colors: {} };
  }
  const name = notesThemeName(state.theme.name);
  monaco.editor.defineTheme(name, toMarkdownMonacoTheme(state.theme));
  return {
    name,
    base: state.theme.type === "light" ? "vs" : "vs-dark",
    colors: workbenchColors(state.theme),
  };
}
