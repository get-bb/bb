import type * as MonacoNs from "monaco-editor";
import type { PluginCodeThemeData } from "@get-bb/plugin-sdk/app";

/**
 * Translates BB's active code theme — a VS Code theme document — into a
 * Monaco theme, so the editor follows "Settings › Appearance › Theme" the way
 * BB's own file preview does rather than sitting on stock `vs` / `vs-dark`.
 *
 * The mapping is the same one Shiki uses for Monaco: Monaco's standalone
 * theme matches rules by dotted-prefix on the token it emits, and its Monarch
 * tokens (`keyword`, `string`, `comment`, `number`, `type`, …) are spelled
 * like the head of a TextMate scope, so TextMate rules land on the right
 * tokens even though nothing here runs a TextMate grammar. Deeper scopes
 * (`meta.function-call.python`) simply never match anything Monaco emits.
 */

/** What Monaco's token-rule parser accepts: 6- or 8-digit hex. */
const TOKEN_COLOR = /^#?([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/;
/** What `Color.fromHex` accepts for the workbench color map. */
const WORKBENCH_COLOR = /^#([0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

/**
 * Monaco rejects a theme name outside `[a-z0-9-]i`, and BB's names are
 * namespaced ids with a content fingerprint (`bb:nord:light:1f4c9a2b`). Map
 * the rejected characters rather than hashing, so the name stays readable in
 * the DOM (Monaco writes it into the editor's class list) and stays unique.
 */
export function monacoThemeName(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9-]/g, "-");
  return `bb-${safe}`;
}

/** Expand `#abc` / `#abcd`; drop anything Monaco's rule parser would throw on. */
function tokenColor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const hex = value.startsWith("#") ? value.slice(1) : value;
  const expanded =
    hex.length === 3 || hex.length === 4
      ? hex
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : hex;
  // Monaco's own themes carry no alpha on token colors and its parser drops
  // the channel it does accept, so an 8-digit value is passed through as-is
  // and simply loses its transparency.
  return TOKEN_COLOR.test(expanded) ? expanded : undefined;
}

function tokenRules(
  theme: PluginCodeThemeData,
): MonacoNs.editor.ITokenThemeRule[] {
  const rules: MonacoNs.editor.ITokenThemeRule[] = [];
  // The default rule. Monaco needs an explicit empty-token rule or unmatched
  // tokens fall back to the base theme's foreground.
  const base = tokenColor(theme.fg);
  if (base !== undefined) rules.push({ token: "", foreground: base });
  for (const rule of theme.tokenColors) {
    const foreground = tokenColor(rule.settings.foreground);
    const background = tokenColor(rule.settings.background);
    const fontStyle = fontStyleFor(rule.settings.fontStyle);
    if (
      foreground === undefined &&
      background === undefined &&
      fontStyle === undefined
    ) {
      continue;
    }
    const scopes =
      rule.scope === undefined
        ? [""]
        : typeof rule.scope === "string"
          ? // A comma-joined scope list is as common in theme files as an array.
            rule.scope.split(",")
          : rule.scope;
    for (const scope of scopes) {
      const token = scope.trim();
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
 * Monaco understands `italic`, `bold`, and `underline` in any combination,
 * and treats an empty string as "no style". TextMate's `strikethrough` has no
 * Monaco equivalent and is dropped.
 */
function fontStyleFor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const styles = value
    .split(/\s+/)
    .filter(
      (style) =>
        style === "italic" || style === "bold" || style === "underline",
    );
  // An explicit "normal" (or a lone "strikethrough") still means "clear what
  // the more general rule set", which Monaco spells as the empty string.
  return styles.join(" ");
}

function workbenchColors(theme: PluginCodeThemeData): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const [id, value] of Object.entries(theme.colors)) {
    // Invalid values resolve to red rather than being ignored, and a theme
    // file may carry a `null` or a color reference we cannot resolve.
    if (typeof value === "string" && WORKBENCH_COLOR.test(value)) {
      colors[id] = value;
    }
  }
  // `editor.background` / `editor.foreground` are what Monaco actually paints
  // the surface with; a theme that only declared the Shiki-level pair still
  // gets a matching editor rather than the base theme's canvas.
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

/**
 * The color Monaco paints the editor surface with, for chrome that has to sit
 * on the same background as the code — the file tree. Null before a theme
 * resolves, and for a theme that declares nothing usable, so a caller can keep
 * its BB surface token instead of guessing.
 */
export function editorBackground(
  theme: PluginCodeThemeData | null,
): string | null {
  if (theme === null) return null;
  return workbenchColors(theme)["editor.background"] ?? null;
}

export function toMonacoTheme(
  theme: PluginCodeThemeData,
): MonacoNs.editor.IStandaloneThemeData {
  return {
    base: theme.type === "light" ? "vs" : "vs-dark",
    // Inherit so every color id the theme leaves out (widget borders, the
    // find match highlight) keeps a coherent default instead of nothing.
    inherit: true,
    rules: tokenRules(theme),
    colors: workbenchColors(theme),
  };
}

/**
 * Defines the theme (idempotent per name and window — Monaco replaces a
 * redefinition) and returns the name to pass as the editor's `theme`.
 */
export function defineMonacoTheme(
  monaco: typeof MonacoNs,
  theme: PluginCodeThemeData,
): string {
  const name = monacoThemeName(theme.name);
  monaco.editor.defineTheme(name, toMonacoTheme(theme));
  return name;
}

/** The Monaco theme currently painted, and the base its widget CSS keys on. */
export interface AppliedMonacoTheme {
  /** Name to pass as the editor's `theme` option. */
  name: string;
  /** `vs` / `vs-dark`, the only theme classes Monaco's stylesheet keys on. */
  base: "vs" | "vs-dark";
}

/**
 * Define BB's current code theme in this Monaco instance and report what to
 * apply. Before the first theme document resolves — and if a palette ships
 * nothing usable — this falls back to Monaco's stock pair for the app's mode.
 *
 * The base is read from the applied document rather than from `mode`, because
 * the two disagree for the frame between a mode switch and the new document
 * resolving, and the widget CSS has to match the colors actually in use.
 */
export function applyCodeTheme(
  monaco: typeof MonacoNs,
  state: { mode: "light" | "dark"; theme: PluginCodeThemeData | null },
): AppliedMonacoTheme {
  if (state.theme === null) {
    const base = state.mode === "dark" ? "vs-dark" : "vs";
    return { name: base, base };
  }
  return {
    name: defineMonacoTheme(monaco, state.theme),
    base: state.theme.type === "light" ? "vs" : "vs-dark",
  };
}
