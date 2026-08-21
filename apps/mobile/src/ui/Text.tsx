import { cva, type VariantProps } from "class-variance-authority";
import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { resolveFont, type FontWeightName } from "@/theme/fonts";
import { cn } from "./cn";

/**
 * Typography roles. Sizes are the touch scale from theme.css (`--text-*`
 * under `pointer: coarse`): 2xs 11, xs 14, sm 15, base 16 (see global.css).
 */
const textVariants = cva("font-sans text-foreground", {
  variants: {
    variant: {
      /** Default UI copy (web `text-sm`). */
      body: "text-sm",
      /** Composer/input copy and long-form reading (web `text-base`). */
      bodyLarge: "text-base",
      /** Screen and sheet titles. */
      title: "text-lg font-semibold",
      /** Card and section headings. */
      heading: "text-base font-semibold",
      /** Form labels, row titles, button copy. */
      label: "text-sm font-medium",
      /** Secondary line under a title. */
      caption: "text-xs text-muted-foreground",
      /** Chrome section labels (web `text-xs subtle-foreground/75`). */
      sectionLabel:
        "text-xs font-medium uppercase tracking-wide text-subtle-foreground/75",
      /** Count chips, ids, unread divider (web `text-2xs`). */
      chrome: "text-2xs text-muted-foreground",
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

export interface TextProps
  extends RNTextProps, VariantProps<typeof textVariants> {
  /** Overrides the weight implied by `variant`/`className`. */
  weight?: FontWeightName;
  /** Forces Fira Code (or Inter when false) regardless of `className`. */
  mono?: boolean;
  className?: string;
}

/**
 * Themed text. Always sets `fontFamily` + `fontWeight` together (Expo Google
 * Fonts register one family per weight), deriving them from `weight`/`mono`
 * or from web-style `font-medium|semibold|bold` / `font-mono` classes.
 */
export function Text({
  variant,
  tone,
  weight,
  mono,
  className,
  style,
  ...props
}: TextProps) {
  const merged = cn(textVariants({ variant, tone }), className);
  const font = resolveFont({ className: merged, weight, mono });
  return <RNText className={merged} style={[font, style]} {...props} />;
}
