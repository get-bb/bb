import { memo, useMemo } from "react";
import {
  Text as RNText,
  type StyleProp,
  type TextProps as RNTextProps,
  type TextStyle,
} from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { nativeTypography } from "@/theme/theme.native";
import { resolveAnsiColors } from "./ansi-styles";
import { ansiToSpans, type AnsiSpan } from "./ansi-to-spans";

/** Web terminal/code blocks: `font-mono text-xs leading-tight` (touch xs = 14px, tight = 1.25). */
export const TERMINAL_FONT_SIZE = nativeTypography.xs.fontSize;
export const TERMINAL_LINE_HEIGHT = Math.round(TERMINAL_FONT_SIZE * 1.25);

export interface AnsiSpansTextProps extends Omit<RNTextProps, "children"> {
  spans: readonly AnsiSpan[];
  fontSize?: number;
  lineHeight?: number;
  style?: StyleProp<TextStyle>;
}

/**
 * One `Text` with a nested `Text` per styled span. Bold swaps to the bold
 * mono face (Android cannot synthesize weights), dim lowers opacity, inverse
 * swaps fg/bg, and colors resolve through the theme's ANSI palette.
 */
export const AnsiSpansText = memo(function AnsiSpansText({
  spans,
  fontSize = TERMINAL_FONT_SIZE,
  lineHeight = TERMINAL_LINE_HEIGHT,
  style,
  ...rest
}: AnsiSpansTextProps) {
  const { tokens, fonts } = useTheme();
  const defaults = useMemo(
    () => ({
      foreground: tokens.mutedForeground,
      background: tokens.background,
    }),
    [tokens],
  );
  const rootStyle = useMemo<TextStyle>(
    () => ({
      fontFamily: fonts.mono.regular,
      fontWeight: "400",
      fontSize,
      lineHeight,
      color: defaults.foreground,
      includeFontPadding: false,
    }),
    [defaults.foreground, fontSize, fonts.mono.regular, lineHeight],
  );

  const children = spans.map((span, index) => {
    const plainStyle =
      span.fg === null &&
      span.bg === null &&
      !span.bold &&
      !span.dim &&
      !span.italic &&
      !span.underline &&
      !span.strikethrough &&
      !span.inverse;
    if (plainStyle) {
      return span.text;
    }
    const colors = resolveAnsiColors(span, tokens, defaults);
    const spanStyle: TextStyle = {
      color: colors.color,
      backgroundColor: colors.backgroundColor,
      fontFamily: span.bold ? fonts.mono.bold : fonts.mono.regular,
      fontWeight: span.bold ? "700" : "400",
      fontStyle: span.italic ? "italic" : "normal",
      opacity: span.dim ? 0.6 : 1,
      textDecorationLine:
        span.underline && span.strikethrough
          ? "underline line-through"
          : span.underline
            ? "underline"
            : span.strikethrough
              ? "line-through"
              : "none",
    };
    return (
      <RNText key={index} style={spanStyle}>
        {span.text}
      </RNText>
    );
  });

  return (
    <RNText style={[rootStyle, style]} {...rest}>
      {/* An empty Text collapses to zero height; keep blank lines tall. */}
      {children.length === 0 ? " " : children}
    </RNText>
  );
});

export interface AnsiTextProps extends Omit<AnsiSpansTextProps, "spans"> {
  /** Raw terminal output (may contain escape sequences). */
  text: string;
}

/** Parses `text` and renders it with `AnsiSpansText`. */
export const AnsiText = memo(function AnsiText({
  text,
  ...rest
}: AnsiTextProps) {
  const spans = useMemo(() => ansiToSpans(text), [text]);
  return <AnsiSpansText spans={spans} {...rest} />;
});
