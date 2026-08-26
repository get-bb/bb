/// <reference types="node" />
/**
 * Generates `src/theme/theme.native.ts` from the web app's CSS theme tokens.
 *
 * React Native has no `var()`, `color-mix()`, or `oklch()`, so this script
 * replays the web cascade (theme.css light/dark blocks, then the mobile-only
 * override layer in `src/theme/mobile-overrides.css`, then a built-in
 * palette's overrides) for every palette × mode and resolves each token to a
 * plain color string. The result is committed; a vitest drift test regenerates
 * it in memory and fails when it no longer matches.
 *
 * Cascade order is the whole contract: the mobile layer re-tunes the DEFAULT
 * palette to the iOS system look (pure black/white anchors, systemBlue tint,
 * system status colors, grouped-list surfaces) while palettes that set their
 * own anchors and literals (Nord, Dracula, …) still win because they cascade
 * last. Every mobile value derives from `--canvas`/`--ink` so those palettes
 * keep tinting the surfaces the layer touches.
 *
 * Run: `pnpm --filter @bb/mobile theme:generate`
 * (`node --conditions=source --import tsx scripts/generate-native-theme.ts`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_THEME_IDS, type BuiltInThemeId } from "@bb/domain";
import { converter, parse, type Color, type Oklab, type Oklch } from "culori";

const MOBILE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_ROOT = join(MOBILE_ROOT, "..", "app");
const THEME_CSS_PATH = join(APP_ROOT, "src", "components", "ui", "theme.css");
const PALETTES_DIR = join(APP_ROOT, "src", "lib", "themes");
/**
 * The mobile-only override layer. Same `:root, .light` / `.dark` custom
 * property shape as theme.css plus a `@theme` block for the native type ramp
 * and the extra radii; the web app never loads it.
 */
export const MOBILE_OVERRIDES_CSS_PATH = join(
  MOBILE_ROOT,
  "src",
  "theme",
  "mobile-overrides.css",
);
export const NATIVE_THEME_OUTPUT_PATH = join(
  MOBILE_ROOT,
  "src",
  "theme",
  "theme.native.ts",
);

export const MODES = ["light", "dark"] as const;
export type Mode = (typeof MODES)[number];

/**
 * Chrome treats the hue of a color *converted* into oklch as powerless
 * (missing) when its chroma is at or below this value, so it carries the other
 * mix operand's hue forward. Colors written directly in `oklch()` keep their
 * hue even at chroma 0. Measured against Chrome 151 (`color-mix(in oklch, …)`
 * with `oklab(0.5 0.02 0)` → hue missing, `oklab(0.5 0.0200001 0)` → kept).
 */
const POWERLESS_HUE_CHROMA = 0.02;

/** Web-only tokens that are deliberately not part of the native theme. */
const WEB_ONLY_TOKEN_PATTERNS: readonly { pattern: RegExp; reason: string }[] =
  [
    {
      pattern: /^diffs-/,
      reason: "@pierre/diffs bridge; defined per mode only",
    },
  ];

// ---------------------------------------------------------------------------
// Tolerant CSS reading: rules → declarations. Only custom properties matter.
// ---------------------------------------------------------------------------

interface CssRule {
  prelude: string;
  body: string;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Splits `prelude { body }` rules at one nesting level; skips `@x …;`. */
function splitRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  let index = 0;
  let start = 0;
  while (index < css.length) {
    const char = css[index];
    if (char === ";") {
      start = index + 1;
      index += 1;
      continue;
    }
    if (char !== "{") {
      index += 1;
      continue;
    }
    const prelude = css.slice(start, index).trim();
    let depth = 1;
    let cursor = index + 1;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === "{") depth += 1;
      else if (css[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    if (depth !== 0) {
      throw new Error(`Unbalanced braces after "${prelude.slice(0, 40)}"`);
    }
    rules.push({ prelude, body: css.slice(index + 1, cursor - 1) });
    start = cursor;
    index = cursor;
  }
  return rules;
}

/** Splits on `separator` outside parentheses. */
function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of input) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** `--name: value` pairs of a rule body, in source order. */
function parseCustomProperties(body: string): [string, string][] {
  const declarations: [string, string][] = [];
  for (const declaration of splitTopLevel(body, ";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const name = declaration.slice(0, colon).trim();
    if (!name.startsWith("--")) continue;
    const value = declaration
      .slice(colon + 1)
      .replace(/\s+/g, " ")
      .trim();
    declarations.push([name.slice(2), value]);
  }
  return declarations;
}

interface ModeRule {
  modes: Mode[];
  declarations: [string, string][];
}

/**
 * Selectors that match `<html>` in each mode. `.dark` is toggled on the root
 * element, so `:root` applies in both modes and `.light` only in light; all
 * three have equal specificity, which makes source order the whole cascade.
 */
function modesForSelector(prelude: string): Mode[] {
  const selectors = prelude.split(",").map((selector) => selector.trim());
  const modes = new Set<Mode>();
  for (const selector of selectors) {
    if (selector === ":root") {
      modes.add("light");
      modes.add("dark");
    } else if (selector === ".light") {
      modes.add("light");
    } else if (selector === ".dark") {
      modes.add("dark");
    }
  }
  return MODES.filter((mode) => modes.has(mode));
}

function modeRules(css: string): ModeRule[] {
  const rules: ModeRule[] = [];
  for (const rule of splitRules(stripComments(css))) {
    if (rule.prelude.startsWith("@")) continue;
    const modes = modesForSelector(rule.prelude);
    if (modes.length === 0) continue;
    rules.push({ modes, declarations: parseCustomProperties(rule.body) });
  }
  return rules;
}

/** Final token → raw value map for one mode after the given rule lists. */
function cascade(mode: Mode, ruleSets: ModeRule[][]): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const rules of ruleSets) {
    for (const rule of rules) {
      if (!rule.modes.includes(mode)) continue;
      for (const [name, value] of rule.declarations) tokens.set(name, value);
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Value resolution: var() substitution, color-mix(), output formatting.
// ---------------------------------------------------------------------------

function substituteVars(
  value: string,
  tokens: ReadonlyMap<string, string>,
  stack: string[] = [],
): string {
  let result = "";
  let index = 0;
  while (index < value.length) {
    const at = value.indexOf("var(", index);
    if (at === -1) {
      result += value.slice(index);
      break;
    }
    result += value.slice(index, at);
    let depth = 1;
    let cursor = at + 4;
    while (cursor < value.length && depth > 0) {
      if (value[cursor] === "(") depth += 1;
      else if (value[cursor] === ")") depth -= 1;
      cursor += 1;
    }
    const [reference, ...fallbackParts] = splitTopLevel(
      value.slice(at + 4, cursor - 1),
      ",",
    );
    const name = reference?.replace(/^--/, "") ?? "";
    if (stack.includes(name)) {
      throw new Error(
        `Cyclic var() reference: ${[...stack, name].join(" → ")}`,
      );
    }
    const referenced = tokens.get(name);
    if (referenced === undefined) {
      if (fallbackParts.length === 0) {
        throw new Error(`var(--${name}) is not defined`);
      }
      result += substituteVars(fallbackParts.join(","), tokens, stack);
    } else {
      result += substituteVars(referenced, tokens, [...stack, name]);
    }
    index = cursor;
  }
  return result;
}

type MixSpace = "oklch" | "oklab";

interface MixOperand {
  color: Color;
  percentage: number | null;
}

const toOklch = converter("oklch");
const toOklab = converter("oklab");
const toRgb = converter("rgb");

function parseMixOperand(input: string): MixOperand | null {
  const trailing = input.match(/^(.*?)\s+(-?[\d.]+)%$/);
  const leading = input.match(/^(-?[\d.]+)%\s+(.*)$/);
  const colorText = trailing?.[1] ?? leading?.[2] ?? input;
  const percentageText = trailing?.[2] ?? leading?.[1];
  const color = parseColorValue(colorText);
  if (color === null) return null;
  return {
    color,
    percentage: percentageText === undefined ? null : Number(percentageText),
  };
}

/**
 * A color expression → culori color, or null when the value is not a color
 * (font stacks, lengths, gradients, shadows). Nested `color-mix()` is allowed.
 */
function parseColorValue(input: string): Color | null {
  const value = input.trim();
  const mix = value.match(/^color-mix\((.*)\)$/s);
  if (!mix) {
    const parsed = parse(value);
    return parsed ?? null;
  }
  const args = splitTopLevel(mix[1] ?? "", ",");
  const [spaceArg, firstArg, secondArg] = args;
  if (args.length !== 3 || !spaceArg || !firstArg || !secondArg) {
    throw new Error(`Unsupported color-mix() shape: ${value}`);
  }
  const space = spaceArg.match(/^in\s+(oklch|oklab)$/)?.[1];
  if (space !== "oklch" && space !== "oklab") {
    throw new Error(
      `Unsupported color-mix() interpolation space in: ${value} (only oklch/oklab)`,
    );
  }
  const first = parseMixOperand(firstArg);
  const second = parseMixOperand(secondArg);
  if (first === null || second === null) {
    throw new Error(`color-mix() operand is not a color: ${value}`);
  }
  return mixColors(space, first, second);
}

/** Normalizes the two operand percentages per CSS Color 5 §3.1. */
function normalizeWeights(
  first: MixOperand,
  second: MixOperand,
): { p1: number; p2: number; alphaMultiplier: number } {
  // Omitted percentages: both → 50/50; one → the complement of the other.
  const p1 =
    first.percentage ??
    (second.percentage === null ? 50 : 100 - second.percentage);
  const p2 = second.percentage ?? 100 - p1;
  const sum = p1 + p2;
  if (sum <= 0) throw new Error("color-mix() percentages sum to zero");
  return {
    p1: p1 / sum,
    p2: p2 / sum,
    alphaMultiplier: sum < 100 ? sum / 100 : 1,
  };
}

/** Premultiplied-alpha linear interpolation of one non-hue channel. */
function mixChannel(
  c1: number | undefined,
  c2: number | undefined,
  a1: number,
  a2: number,
  p1: number,
  p2: number,
  alpha: number,
): number {
  // A missing channel takes the other operand's value (CSS Color 4 §12.2).
  const v1 = c1 ?? c2 ?? 0;
  const v2 = c2 ?? c1 ?? 0;
  if (alpha === 0) return 0;
  return (v1 * a1 * p1 + v2 * a2 * p2) / alpha;
}

/** Shorter-arc hue interpolation; hue is never premultiplied. */
function mixHue(
  h1: number | undefined,
  h2: number | undefined,
  p1: number,
  p2: number,
): number | undefined {
  if (h1 === undefined) return h2;
  if (h2 === undefined) return h1;
  let delta = h2 - h1;
  if (delta > 180) delta -= 360;
  else if (delta < -180) delta += 360;
  const hue = (h1 * p1 + (h1 + delta) * p2) % 360;
  return hue < 0 ? hue + 360 : hue;
}

/**
 * `color-mix()` as Chrome computes it: convert both operands to the
 * interpolation space, carry missing components across, interpolate with
 * premultiplied alpha (hue excepted, shorter arc), then apply the alpha
 * multiplier for percentages summing below 100%.
 */
function mixColors(
  space: MixSpace,
  first: MixOperand,
  second: MixOperand,
): Color {
  const { p1, p2, alphaMultiplier } = normalizeWeights(first, second);
  const a1 = first.color.alpha ?? 1;
  const a2 = second.color.alpha ?? 1;
  const alpha = a1 * p1 + a2 * p2;
  const outAlpha = alpha * alphaMultiplier;
  if (space === "oklab") {
    const c1 = toOklab(first.color);
    const c2 = toOklab(second.color);
    const result: Oklab = {
      mode: "oklab",
      l: mixChannel(c1.l, c2.l, a1, a2, p1, p2, alpha),
      a: mixChannel(c1.a, c2.a, a1, a2, p1, p2, alpha),
      b: mixChannel(c1.b, c2.b, a1, a2, p1, p2, alpha),
    };
    if (outAlpha !== 1) result.alpha = outAlpha;
    return result;
  }
  const c1 = toOklch(first.color);
  const c2 = toOklch(second.color);
  const hueOf = (source: Color, converted: Oklch): number | undefined => {
    if (converted.h === undefined) return undefined;
    const wasConverted = source.mode !== "oklch";
    return wasConverted && converted.c <= POWERLESS_HUE_CHROMA
      ? undefined
      : converted.h;
  };
  const result: Oklch = {
    mode: "oklch",
    l: mixChannel(c1.l, c2.l, a1, a2, p1, p2, alpha),
    c: mixChannel(c1.c, c2.c, a1, a2, p1, p2, alpha),
  };
  const hue = mixHue(hueOf(first.color, c1), hueOf(second.color, c2), p1, p2);
  if (hue !== undefined) result.h = hue;
  if (outAlpha !== 1) result.alpha = outAlpha;
  return result;
}

function channel255(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

/** `#rrggbb` for opaque colors, `rgba(r, g, b, a)` (3-decimal alpha) otherwise. */
export function formatNativeColor(color: Color): string {
  const rgb = toRgb(color);
  const r = channel255(rgb.r);
  const g = channel255(rgb.g);
  const b = channel255(rgb.b);
  const alpha = Math.round((rgb.alpha ?? 1) * 1000) / 1000;
  if (alpha >= 1) {
    return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** `0.5rem` / `4px` / `calc(<length> ± <length>)` → CSS pixels (1rem = 16px). */
function lengthToPx(input: string): number {
  const value = input.trim();
  const calc = value.match(/^calc\((.*)\)$/s);
  if (calc) {
    const expression = calc[1] ?? "";
    const parts = expression.split(/\s+([+-])\s+/);
    let total = lengthToPx(parts[0] ?? "");
    for (let index = 1; index < parts.length; index += 2) {
      const operand = lengthToPx(parts[index + 1] ?? "");
      total += parts[index] === "-" ? -operand : operand;
    }
    return total;
  }
  const match = value.match(/^(-?[\d.]+)(rem|px)$/);
  if (!match) throw new Error(`Unsupported length: ${input}`);
  const number = Number(match[1]);
  return match[2] === "rem" ? number * 16 : number;
}

function camelCase(tokenName: string): string {
  return tokenName.replace(/-+([a-z0-9])/g, (_, char: string) =>
    char.toUpperCase(),
  );
}

// ---------------------------------------------------------------------------
// Theme model
// ---------------------------------------------------------------------------

export interface NativeTextStyle {
  fontSize: number;
  lineHeight: number;
}

export interface SkippedToken {
  name: string;
  reason: string;
}

export interface NativeRadii {
  base: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  /** Tailwind's `rounded-2xl` step (`--radius-2xl`). */
  xl2: number;
  /** Tailwind's `rounded-full` (`--radius-full`): any pill/circle. */
  full: number;
}

export const RADII_KEYS = [
  "base",
  "sm",
  "md",
  "lg",
  "xl",
  "xl2",
  "full",
] as const satisfies readonly (keyof NativeRadii)[];

export interface NativeThemeModel {
  /** palette → mode → camelCase token → RN color string. */
  themes: Map<BuiltInThemeId, Record<Mode, Record<string, string>>>;
  /** Sorted camelCase color token names (identical across palettes/modes). */
  tokenKeys: string[];
  /**
   * Kebab-case names the mobile layer declares that theme.css does not. The
   * web has no utility class for these; global.css maps them by hand.
   */
  mobileOnlyTokens: string[];
  radii: NativeRadii;
  /** Ordered by font size. */
  typography: [name: string, style: NativeTextStyle][];
  skipped: SkippedToken[];
}

export interface ThemeSources {
  themeCss: string;
  /**
   * Mobile-only override layer (`MOBILE_OVERRIDES_CSS_PATH`). Cascades after
   * theme.css and before every palette, so palettes keep winning.
   */
  mobileCss: string;
  /** Palette override CSS per built-in id ("" for `default`). */
  paletteCss: ReadonlyMap<BuiltInThemeId, string>;
}

function readSources(): ThemeSources {
  const themeCss = readFileSync(THEME_CSS_PATH, "utf8");
  const mobileCss = readFileSync(MOBILE_OVERRIDES_CSS_PATH, "utf8");
  const paletteCss = new Map<BuiltInThemeId, string>();
  for (const id of BUILTIN_THEME_IDS) {
    // "default" is theme.css itself (the registry maps it to "").
    if (id === "default") {
      paletteCss.set(id, "");
      continue;
    }
    const source = readFileSync(join(PALETTES_DIR, `${id}.ts`), "utf8");
    const css = source.match(/ThemeCss\s*=\s*`([\s\S]*?)`;/)?.[1];
    if (css === undefined) {
      throw new Error(`No \`<id>ThemeCss\` template literal in ${id}.ts`);
    }
    paletteCss.set(id, css);
  }
  return { themeCss, mobileCss, paletteCss };
}

function webOnlyReason(name: string): string | null {
  for (const { pattern, reason } of WEB_ONLY_TOKEN_PATTERNS) {
    if (pattern.test(name)) return reason;
  }
  return null;
}

/** Custom properties of every `@theme` block (not `@theme inline`) in `css`. */
function themeBlockProperties(css: string): Map<string, string> {
  const declared = new Map<string, string>();
  for (const rule of splitRules(stripComments(css))) {
    if (rule.prelude !== "@theme") continue;
    for (const [name, value] of parseCustomProperties(rule.body)) {
      declared.set(name, value);
    }
  }
  return declared;
}

/**
 * Radii: `--radius-sm|md|lg|xl` from theme.css's `@theme inline` block
 * (derived from `--radius`), plus `--radius-2xl` / `--radius-full` from the
 * mobile layer's `@theme` block — the web leaves those at Tailwind's defaults
 * (1rem and `calc(infinity * 1px)`), which the native side needs as numbers.
 */
function readRadii(
  themeCss: string,
  mobileCss: string,
  lightTokens: ReadonlyMap<string, string>,
): NativeRadii {
  const inline = splitRules(stripComments(themeCss)).find(
    (rule) => rule.prelude === "@theme inline",
  );
  if (!inline) throw new Error("theme.css has no `@theme inline` block");
  const declared = new Map(parseCustomProperties(inline.body));
  const radius = (name: string): number => {
    const raw = declared.get(name);
    if (raw === undefined)
      throw new Error(`--${name} missing in @theme inline`);
    return lengthToPx(substituteVars(raw, lightTokens));
  };
  const mobile = themeBlockProperties(mobileCss);
  const mobileRadius = (name: string): number => {
    const raw = mobile.get(name);
    if (raw === undefined) {
      throw new Error(`--${name} missing in mobile-overrides.css @theme`);
    }
    return lengthToPx(raw);
  };
  return {
    base: lengthToPx(substituteVars("var(--radius)", lightTokens)),
    sm: radius("radius-sm"),
    md: radius("radius-md"),
    lg: radius("radius-lg"),
    xl: radius("radius-xl"),
    xl2: mobileRadius("radius-2xl"),
    full: mobileRadius("radius-full"),
  };
}

/**
 * `--text-*` scale: theme.css's `@theme` overrides, then its coarse-pointer
 * `@media … (pointer: coarse) { :root {…} }` block (touch sizes are the
 * native base; there is no fine pointer on a phone), then the mobile layer's
 * `@theme` block on top, which carries the Apple text-style ramp.
 */
function readTypography(
  themeCss: string,
  mobileCss: string,
): NativeThemeModel["typography"] {
  const declared = new Map<string, string>();
  const rules = splitRules(stripComments(themeCss));
  for (const [name, value] of themeBlockProperties(themeCss)) {
    if (name.startsWith("text-")) declared.set(name, value);
  }
  for (const rule of rules) {
    if (
      !rule.prelude.startsWith("@media") ||
      !/pointer:\s*coarse/.test(rule.prelude)
    ) {
      continue;
    }
    for (const inner of splitRules(rule.body)) {
      if (!modesForSelector(inner.prelude).includes("light")) continue;
      for (const [name, value] of parseCustomProperties(inner.body)) {
        if (name.startsWith("text-")) declared.set(name, value);
      }
    }
  }
  for (const [name, value] of themeBlockProperties(mobileCss)) {
    if (name.startsWith("text-")) declared.set(name, value);
  }
  const styles: [string, NativeTextStyle][] = [];
  for (const [name, value] of declared) {
    if (name.includes("--")) continue;
    const size = name.slice("text-".length);
    const lineHeight = declared.get(`${name}--line-height`);
    if (lineHeight === undefined) {
      throw new Error(`--${name} has no --${name}--line-height`);
    }
    styles.push([
      size,
      { fontSize: lengthToPx(value), lineHeight: lengthToPx(lineHeight) },
    ]);
  }
  return styles.sort(
    (a, b) => a[1].fontSize - b[1].fontSize || a[0].localeCompare(b[0]),
  );
}

/** Short label for a non-color token, for the generated header. */
function describeNonColor(name: string, value: string): string {
  if (name.startsWith("font-")) return "font stack";
  if (value.startsWith("linear-gradient(")) return "gradient";
  if (/(^|\s)-?[\d.]+px\s+-?[\d.]+px\b/.test(value)) return "box-shadow";
  if (/^-?[\d.]+(px|rem|em|%)?$/.test(value)) return `dimension (${value})`;
  if (/^(calc\(|var\()/.test(value)) return "computed dimension";
  return `unsupported value (${value.slice(0, 40)})`;
}

/**
 * A token the mobile layer sets under `:root` must also get a `.dark` value:
 * `:root` reaches dark mode too, so without one the override would silently
 * replace theme.css's dark value. `.dark`-only overrides are fine (light keeps
 * the web value), as are `.light`-only ones.
 */
function assertRootOverridesHaveDarkTwins(rules: ModeRule[]): void {
  const viaRoot = new Set<string>();
  const viaDark = new Set<string>();
  for (const rule of rules) {
    const target =
      rule.modes.length === 2
        ? viaRoot
        : rule.modes[0] === "dark"
          ? viaDark
          : null;
    if (target === null) continue;
    for (const [name] of rule.declarations) target.add(name);
  }
  const missing = [...viaRoot].filter((name) => !viaDark.has(name));
  if (missing.length > 0) {
    throw new Error(
      `mobile-overrides.css sets ${missing.map((name) => `--${name}`).join(", ")} under \`:root\` (which reaches dark mode) without a \`.dark\` value`,
    );
  }
}

/**
 * Builds the full native theme model from theme.css, the mobile override
 * layer, and the palette CSS strings.
 */
export function buildNativeThemeModel(
  sources: ThemeSources = readSources(),
): NativeThemeModel {
  const baseRules = modeRules(sources.themeCss);
  const mobileRules = modeRules(sources.mobileCss);
  assertRootOverridesHaveDarkTwins(mobileRules);
  // The default palette is theme.css with the mobile layer on top; every other
  // palette cascades after both, so its anchors and literals keep winning.
  const defaultTokens = {
    light: cascade("light", [baseRules, mobileRules]),
    dark: cascade("dark", [baseRules, mobileRules]),
  };
  const webNames = new Set([
    ...cascade("light", [baseRules]).keys(),
    ...cascade("dark", [baseRules]).keys(),
  ]);

  // Classify every token once, from the default palette. The set of native
  // color tokens must be identical in both modes: a token added to one mode
  // only is the regression theme.test.ts guards against on the web.
  const allNames = [
    ...new Set([...defaultTokens.light.keys(), ...defaultTokens.dark.keys()]),
  ].sort();
  const skipped: SkippedToken[] = [];
  const knownNames = new Set<string>();
  const colorNames: string[] = [];
  const oneModeOnly: string[] = [];
  for (const name of allNames) {
    const webOnly = webOnlyReason(name);
    if (webOnly !== null) {
      skipped.push({ name, reason: webOnly });
      continue;
    }
    knownNames.add(name);
    const rawByMode = MODES.map((mode) => defaultTokens[mode].get(name));
    if (rawByMode.some((raw) => raw === undefined)) {
      oneModeOnly.push(name);
      continue;
    }
    if (name === "radius") {
      skipped.push({ name, reason: "emitted as nativeRadii" });
      continue;
    }
    const resolvedByMode = MODES.map((mode) =>
      parseColorValue(
        substituteVars(
          defaultTokens[mode].get(name) ?? "",
          defaultTokens[mode],
        ),
      ),
    );
    const isColor = resolvedByMode.every((color) => color !== null);
    if (!isColor && resolvedByMode.some((color) => color !== null)) {
      throw new Error(`--${name} is a color in one mode but not the other`);
    }
    if (isColor) {
      colorNames.push(name);
    } else {
      skipped.push({
        name,
        reason: describeNonColor(name, defaultTokens.light.get(name) ?? ""),
      });
    }
  }
  if (oneModeOnly.length > 0) {
    throw new Error(
      `theme.css + mobile-overrides.css define tokens in one mode only: ${oneModeOnly.map((name) => `--${name}`).join(", ")}`,
    );
  }

  const themes: NativeThemeModel["themes"] = new Map();
  for (const id of BUILTIN_THEME_IDS) {
    const css = sources.paletteCss.get(id);
    if (css === undefined) throw new Error(`No palette CSS for "${id}"`);
    const paletteRules = modeRules(css);
    for (const rule of paletteRules) {
      for (const [name] of rule.declarations) {
        if (!knownNames.has(name) && webOnlyReason(name) === null) {
          throw new Error(
            `Palette "${id}" declares --${name}, which theme.css does not define`,
          );
        }
      }
    }
    const resolveMode = (mode: Mode): Record<string, string> => {
      const tokens = cascade(mode, [baseRules, mobileRules, paletteRules]);
      const resolved: Record<string, string> = {};
      for (const name of colorNames) {
        const raw = tokens.get(name);
        if (raw === undefined)
          throw new Error(`--${name} lost in ${id}/${mode}`);
        const color = parseColorValue(substituteVars(raw, tokens));
        if (color === null) {
          throw new Error(
            `Palette "${id}" (${mode}) sets --${name} to a non-color: ${raw}`,
          );
        }
        resolved[camelCase(name)] = formatNativeColor(color);
      }
      return resolved;
    };
    themes.set(id, { light: resolveMode("light"), dark: resolveMode("dark") });
  }

  return {
    themes,
    tokenKeys: colorNames.map(camelCase).sort(),
    mobileOnlyTokens: colorNames.filter((name) => !webNames.has(name)),
    radii: readRadii(sources.themeCss, sources.mobileCss, defaultTokens.light),
    typography: readTypography(sources.themeCss, sources.mobileCss),
    skipped,
  };
}

// ---------------------------------------------------------------------------
// Emission (Oxfmt-canonical so `oxfmt` is a no-op).
// ---------------------------------------------------------------------------

function quoteKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function emitTokenObject(
  tokens: Record<string, string>,
  keys: readonly string[],
  indent: string,
): string {
  const lines = keys.map(
    (key) => `${indent}  ${quoteKey(key)}: ${JSON.stringify(tokens[key])},`,
  );
  return `{\n${lines.join("\n")}\n${indent}}`;
}

export function renderNativeThemeSource(model: NativeThemeModel): string {
  const skippedLines = model.skipped.map(
    ({ name, reason }) => ` *   --${name}: ${reason}`,
  );
  const mobileOnlyLines = model.mobileOnlyTokens.map(
    (name) => ` *   --${name}`,
  );
  const header = [
    "/**",
    " * GENERATED FILE — run pnpm --filter @bb/mobile theme:generate",
    " *",
    " * Source: apps/app/src/components/ui/theme.css, then the mobile-only override",
    " * layer apps/mobile/src/theme/mobile-overrides.css, then the built-in palettes",
    " * in apps/app/src/lib/themes/*.ts, replayed through the web cascade per",
    " * palette and mode by apps/mobile/scripts/generate-native-theme.ts. The",
    " * mobile layer re-tunes the default palette to the iOS system look; palettes",
    " * cascade after it, so their anchors and literals still win.",
    " *",
    " * `var()` is substituted textually; `color-mix(in oklch|oklab, …)` is",
    " * evaluated like Chrome (premultiplied alpha, shorter hue arc, converted",
    " * near-achromatic operands lose their hue). Opaque results are `#rrggbb`,",
    " * translucent ones `rgba(r, g, b, a)`. Typography is the Apple text-style",
    " * ramp from the mobile layer's `@theme` block, in CSS pixels.",
    " *",
    " * Tokens only the mobile layer defines (no web utility class; global.css",
    " * maps them by hand):",
    ...mobileOnlyLines,
    " *",
    " * Tokens deliberately left out (edit the generator to add them):",
    ...skippedLines,
    " */",
    'import type { BuiltInThemeId } from "@bb/domain";',
    "",
  ];

  const tokenInterface = [
    "/**",
    " * theme.css custom-property color tokens, keyed by camelCase name. Every",
    " * value is a React Native color string.",
    " */",
    "export interface NativeThemeTokens {",
    ...model.tokenKeys.map((key) => `  ${quoteKey(key)}: string;`),
    "}",
    "",
    "export interface NativeThemeModes {",
    "  light: NativeThemeTokens;",
    "  dark: NativeThemeTokens;",
    "}",
    "",
  ];

  const palettes = [...model.themes.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const themesLines = [
    "export const nativeThemes: Record<BuiltInThemeId, NativeThemeModes> = {",
    ...palettes.flatMap(([id, modes]) => [
      `  ${quoteKey(id)}: {`,
      ...MODES.map(
        (mode) =>
          `    ${mode}: ${emitTokenObject(modes[mode], model.tokenKeys, "    ")},`,
      ),
      "  },",
    ]),
    "};",
    "",
  ];

  const radiiLines = [
    "/**",
    " * `--radius` and the Tailwind `--radius-*` steps, in CSS pixels. `xl2` is",
    " * `rounded-2xl`; `full` is `rounded-full` (pills, circles).",
    " */",
    "export const nativeRadii = {",
    ...RADII_KEYS.map((key) => `  ${key}: ${model.radii[key]},`),
    "};",
    "",
  ];

  const typographyLines = [
    "export interface NativeTextStyle {",
    "  fontSize: number;",
    "  lineHeight: number;",
    "}",
    "",
    "/**",
    " * The `--text-*` scale: theme.css's coarse-pointer (touch) values with the",
    " * mobile layer's Apple text-style ramp on top (caption2 → largeTitle), in",
    " * CSS pixels. Mirrored as ratios in global.css (theme-vars.test.ts).",
    " */",
    "export const nativeTypography = {",
    ...model.typography.flatMap(([name, style]) => [
      `  ${quoteKey(name)}: {`,
      `    fontSize: ${style.fontSize},`,
      `    lineHeight: ${style.lineHeight},`,
      "  },",
    ]),
    "} satisfies Record<string, NativeTextStyle>;",
    "",
    "export type NativeTextSize = keyof typeof nativeTypography;",
  ];

  return [
    ...header,
    ...tokenInterface,
    ...themesLines,
    ...radiiLines,
    ...typographyLines,
    "",
  ].join("\n");
}

/** Full pipeline: read sources → model → file contents. */
export function generateNativeThemeSource(): string {
  return renderNativeThemeSource(buildNativeThemeModel());
}

function main(): void {
  const source = generateNativeThemeSource();
  writeFileSync(NATIVE_THEME_OUTPUT_PATH, source);
  console.log(`wrote ${NATIVE_THEME_OUTPUT_PATH}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
