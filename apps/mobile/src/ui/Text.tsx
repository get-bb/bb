import { cva, type VariantProps } from "class-variance-authority";
import {
  Text as RNText,
  type TextProps as RNTextProps,
  type TextStyle,
} from "react-native";
import { resolveFont, type FontWeightName } from "@/theme/fonts";
import { cn } from "./cn";

const IS_IOS = process.env.EXPO_OS === "ios";

/**
 * Grouped-list section header. iOS writes it in sentence case, footnote
 * size, secondary color (no tracking); Android keeps the Material-style
 * uppercase overline. Both literals stay in source so Tailwind's scanner
 * emits the classes for either platform.
 */
const SECTION_LABEL_CLASS = IS_IOS
  ? "text-xs text-muted-foreground"
  : "text-xs font-medium uppercase tracking-wide text-subtle-foreground/75";

/**
 * Typography roles on the Apple text-style ramp (`--text-*` in global.css):
 * 2xs 11 caption2 · xs 13 footnote · sm 15 subheadline · base 17 body ·
 * lg 20 title3 · xl 22 title2 · 2xl 28 title1 · 3xl 34 largeTitle.
 */
const textVariants = cva("font-sans text-foreground", {
  variants: {
    variant: {
      /** Dense UI copy: rows in sheets, chrome, secondary lines (15). */
      body: "text-sm",
      /** Conversation prose, row titles, input copy (17). */
      bodyLarge: "text-base",
      /** Screen and sheet titles (22/700, title2). */
      title: "text-xl font-bold",
      /** Card and section headings (17/600, headline). */
      heading: "text-base font-semibold",
      /** Emphasized row title (17/600, headline). */
      headline: "text-base font-semibold",
      /** Form labels, pill copy, button copy (15/500). */
      label: "text-sm font-medium",
      /** Secondary line under a title (13, footnote, muted). */
      caption: "text-xs text-muted-foreground",
      /** Footnote in the foreground color (grouped footers set their tone). */
      footnote: "text-xs",
      /** Grouped section header. */
      sectionLabel: SECTION_LABEL_CLASS,
      /** Count chips, ids, unread divider (11, caption2). */
      chrome: "text-2xs text-muted-foreground",
      /** In-body large title (34/700); navigation headers use the native Stack. */
      largeTitle: "text-3xl font-bold",
      /** Code, paths, ids. */
      mono: "font-mono text-sm",
    },
    tone: {
      default: "",
      foreground: "text-foreground",
      muted: "text-muted-foreground",
      subtle: "text-subtle-foreground",
      readback: "text-readback-foreground",
      primary: "text-primary",
      destructive: "text-destructive-text",
      warning: "text-warning-text",
      success: "text-success",
      inverse: "text-background",
    },
  },
  defaultVariants: {
    variant: "body",
    tone: "default",
  },
});

export type TextVariant = NonNullable<
  VariantProps<typeof textVariants>["variant"]
>;
export type TextTone = NonNullable<VariantProps<typeof textVariants>["tone"]>;

const TABULAR_NUMS: TextStyle = { fontVariant: ["tabular-nums"] };

export interface TextProps
  extends RNTextProps, VariantProps<typeof textVariants> {
  /** Overrides the weight implied by `variant`/`className`. */
  weight?: FontWeightName;
  /** Forces the mono face (or sans when false) regardless of `className`. */
  mono?: boolean;
  /** Tabular figures for counters, timers, sizes, line numbers. */
  numeric?: boolean;
  className?: string;
}

/**
 * Themed text. Always sets `fontFamily` + `fontWeight` together (the system
 * face on iOS, `sans-serif` on Android; see src/theme/fonts.ts), deriving
 * them from `weight`/`mono` or from web-style `font-medium|semibold|bold` /
 * `font-mono` classes.
 */
export function Text({
  variant,
  tone,
  weight,
  mono,
  numeric = false,
  className,
  style,
  ...props
}: TextProps) {
  const merged = cn(textVariants({ variant, tone }), className);
  const font = resolveFont({ className: merged, weight, mono });
  return (
    <RNText
      className={merged}
      style={[font, numeric ? TABULAR_NUMS : null, style]}
      {...props}
    />
  );
}
