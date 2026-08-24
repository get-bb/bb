import type { NativeThemeTokens } from "@/theme/theme.native";
import type { TerminalPageTheme } from "./terminal-bridge";

/**
 * xterm theme from the native tokens (the web's
 * `buildTerminalThemeFromCssColors`: the canvas and cursor cutout are the
 * sidebar surface, selection is `muted`, ANSI 0-15 are the palette's
 * `--ansi-*`).
 */
export function buildTerminalThemeFromTokens(
  tokens: NativeThemeTokens,
): TerminalPageTheme {
  return {
    background: tokens.sidebar,
    foreground: tokens.foreground,
    cursor: tokens.foreground,
    cursorAccent: tokens.sidebar,
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
