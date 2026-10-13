import type { DecorationStyle } from "./vscode-settings.js";

/**
 * Colour lookup for a `theme.<workbenchColorId>` reference.
 *
 * The VS Code Highlight extension lets a decoration name a workbench colour
 * instead of a literal, which is how `theme.textLink.activeForeground` keeps
 * `@mentions` readable in both light and dark. BB hands the active code
 * theme's workbench colours over the SDK, so the same ids resolve here.
 */
export type WorkbenchColors = Readonly<Record<string, string>>;

const THEME_PREFIX = "theme.";

/**
 * Only colour-shaped values reach CSS. A decoration comes from a settings
 * file, and its strings land in a stylesheet, so anything that could close a
 * declaration and start another is rejected rather than escaped.
 */
const SAFE_COLOR =
  /^(#[0-9A-Fa-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[A-Za-z]{3,20})$/;

const SAFE_FONT_WEIGHT = /^(normal|bold|lighter|bolder|[1-9]00)$/;
const SAFE_FONT_STYLE = /^(normal|italic|oblique)$/;
const SAFE_TEXT_DECORATION =
  /^(none|underline|overline|line-through|underline wavy|line-through solid)$/;

export function resolveColor(
  value: string | undefined,
  colors: WorkbenchColors,
): string | undefined {
  if (value === undefined) return undefined;
  const literal = value.startsWith(THEME_PREFIX)
    ? colors[value.slice(THEME_PREFIX.length)]
    : value;
  if (literal === undefined) return undefined;
  return SAFE_COLOR.test(literal.trim()) ? literal.trim() : undefined;
}

/**
 * Builds the CSS declarations for one decoration. Returns "" when nothing
 * survived validation, which the caller treats as "no class needed".
 */
export function decorationCss(
  style: DecorationStyle,
  colors: WorkbenchColors,
): string {
  const declarations: string[] = [];

  const color = resolveColor(style.color, colors);
  if (color !== undefined) {
    // `!important` because Monaco's own token rules target the same spans
    // with equal specificity, and the user's rule is the more specific
    // intent of the two.
    declarations.push(`color:${color} !important`);
  }

  const background = resolveColor(style.backgroundColor, colors);
  if (background !== undefined) {
    declarations.push(`background-color:${background}`);
  }

  const weight = style.fontWeight?.trim();
  if (weight !== undefined && SAFE_FONT_WEIGHT.test(weight)) {
    declarations.push(`font-weight:${weight}`);
  }

  const fontStyle = style.fontStyle?.trim();
  if (fontStyle !== undefined && SAFE_FONT_STYLE.test(fontStyle)) {
    declarations.push(`font-style:${fontStyle}`);
  }

  const decoration = style.textDecoration?.trim();
  if (decoration !== undefined && SAFE_TEXT_DECORATION.test(decoration)) {
    declarations.push(`text-decoration:${decoration}`);
  }

  return declarations.join(";");
}

function hashed(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function decorationClassName(css: string): string {
  return `bb-notes-hl-${hashed(css)}`;
}

const STYLE_ELEMENT_ID = "bb-plugin-notes-highlight-styles";

/**
 * Interns decoration styles as CSS classes in a single stylesheet.
 *
 * Monaco styles a decoration by class name, not inline, so each distinct
 * style needs a rule somewhere. Keying the class on a hash of its own
 * declarations means re-running the same ruleset reuses the same classes and
 * the sheet stops growing once every style has been seen.
 */
export class DecorationStyleSheet {
  private readonly emitted = new Set<string>();
  private element: HTMLStyleElement | null = null;

  classFor(style: DecorationStyle, colors: WorkbenchColors): string | null {
    const css = decorationCss(style, colors);
    if (css === "") return null;
    const className = decorationClassName(css);
    if (!this.emitted.has(className)) {
      this.emitted.add(className);
      this.sheet().append(`.${className}{${css}}\n`);
    }
    return className;
  }

  /**
   * Drops every rule. Needed when the theme changes: a class generated from
   * the old theme's `theme.*` lookups has the old colour baked into its
   * declarations, and its hash would otherwise keep it alive.
   */
  reset(): void {
    this.emitted.clear();
    if (this.element !== null) this.element.textContent = "";
  }

  private sheet(): HTMLStyleElement {
    if (this.element !== null && this.element.isConnected) {
      return this.element;
    }
    const existing = document.getElementById(STYLE_ELEMENT_ID);
    if (existing instanceof HTMLStyleElement) {
      this.element = existing;
      return existing;
    }
    const created = document.createElement("style");
    created.id = STYLE_ELEMENT_ID;
    document.head.appendChild(created);
    this.element = created;
    return created;
  }
}
