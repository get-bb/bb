/**
 * Maps parsed ANSI spans onto theme colors. Pure (no React Native) so the
 * palette rules are testable: 16-color indexes resolve through `ansi0`…
 * `ansi15`; a background without an explicit foreground forces the matching
 * `ansiBgFg*` contrast color (the web's `addBackgroundContrastColors`);
 * inverse swaps the two sides.
 */
import type { NativeThemeTokens } from "@/theme/theme.native";
import type { AnsiPaletteIndex, AnsiSpan } from "./ansi-to-spans";

export interface AnsiDefaultColors {
  /** Text color for spans with no ANSI foreground. */
  foreground: string;
  /** Surface color used as the "background" side of an inverse span. */
  background: string;
}

export interface ResolvedAnsiColors {
  color: string;
  backgroundColor: string | undefined;
}

function ansiPaletteColor(
  tokens: NativeThemeTokens,
  index: AnsiPaletteIndex,
): string {
  return tokens[`ansi${index}`];
}

function ansiBackgroundContrastColor(
  tokens: NativeThemeTokens,
  index: AnsiPaletteIndex,
): string {
  return tokens[`ansiBgFg${index}`];
}

export function resolveAnsiColors(
  span: Pick<AnsiSpan, "fg" | "bg" | "inverse">,
  tokens: NativeThemeTokens,
  defaults: AnsiDefaultColors,
): ResolvedAnsiColors {
  let color =
    span.fg !== null ? ansiPaletteColor(tokens, span.fg) : defaults.foreground;
  let backgroundColor =
    span.bg !== null ? ansiPaletteColor(tokens, span.bg) : undefined;
  if (span.bg !== null && span.fg === null) {
    color = ansiBackgroundContrastColor(tokens, span.bg);
  }
  if (span.inverse) {
    const swappedColor = backgroundColor ?? defaults.background;
    backgroundColor = color;
    color = swappedColor;
  }
  return { color, backgroundColor };
}
