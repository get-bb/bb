import { cva, type VariantProps } from "class-variance-authority";
import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { resolveFont, type FontWeightName } from "@/theme/fonts";
import { cn } from "./cn";

const IS_IOS = process.env.EXPO_OS === "ios";

const SECTION_LABEL_CLASS = IS_IOS
  ? "text-xs text-muted-foreground"
  : "text-xs font-medium uppercase tracking-wide text-subtle-foreground/75";

const textVariants = cva("font-sans text-foreground", {
  variants: {
    variant: {
      body: "text-sm",
      bodyLarge: "text-base",
      heading: "text-base font-semibold",
      headline: "text-base font-semibold",
      caption: "text-xs text-muted-foreground",
      footnote: "text-xs",
      sectionLabel: SECTION_LABEL_CLASS,
    },
    tone: {
      default: "",
      muted: "text-muted-foreground",
      primary: "text-primary",
      destructive: "text-destructive-text",
      warning: "text-warning-text",
      success: "text-success",
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
  weight?: FontWeightName;
  mono?: boolean;
  className?: string;
}

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
