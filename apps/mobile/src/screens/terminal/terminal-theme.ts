import type { NativeThemeTokens } from "@/theme/theme.native";
import type { TerminalPageTheme } from "./terminal-bridge";

/**
 * xterm theme from the native tokens (the web's
 * `buildTerminalThemeFromCssColors`): the canvas and cursor cutout are the
 * raised solid surface — the workspace panel's sheet color, which the
 * terminal chrome (toolbar, accessory bar, status card) is painted with too,
 * so the page and its frame read as one — selection is `muted`, ANSI 0-15
 * are the palette's `--ansi-*`. Strings only: the theme is serialized to the
 * WebView page.
 */
export function buildTerminalThemeFromTokens(
  tokens: NativeThemeTokens,
): TerminalPageTheme {
  return {
    background: tokens.surfaceRaisedSolid,
    foreground: tokens.foreground,
    cursor: tokens.foreground,
    cursorAccent: tokens.surfaceRaisedSolid,
    selectionBackground: tokens.muted,
    black: tokens.ansi0,
    red: tokens.ansi1,
    green: tokens.ansi2,
    yellow: tokens.ansi3,
    blue: tokens.ansi4,
    magenta: tokens.ansi5,
    cyan: tokens.ansi6,
    white: tokens.ansi7,
    brightBlack: tokens.ansi8,
    brightRed: tokens.ansi9,
    brightGreen: tokens.ansi10,
    brightYellow: tokens.ansi11,
    brightBlue: tokens.ansi12,
    brightMagenta: tokens.ansi13,
    brightCyan: tokens.ansi14,
    brightWhite: tokens.ansi15,
  };
}

/** Touch-sized default; the web uses 12 on desktop. */
export const TERMINAL_FONT_SIZE = 12;
