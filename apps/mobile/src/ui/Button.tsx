import { cva, type VariantProps } from "class-variance-authority";
import { useState, type ReactNode } from "react";
import { Pressable, View, type PressableProps } from "react-native";
import { haptic, hapticKindForButton, type ButtonHaptic } from "@/lib/haptics";
import { withAlpha } from "@/theme/colors";
import { useTheme } from "@/theme/ThemeProvider";
import type { NativeThemeTokens } from "@/theme/theme.native";
import { cn } from "./cn";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./Spinner";
import { Text } from "./Text";

const IS_IOS = process.env.EXPO_OS === "ios";

/*
 * Variant and size names mirror packages/shared-ui/src/components/ui/button.tsx
 * so call sites port unchanged. Android renders the web shapes (below);
 * iOS maps the same names onto the system button styles:
 *
 *   default              → filled   (primary capsule, white label)
 *   destructive          → filled   (destructive capsule)
 *   outline · secondary  → tinted   (primary at 15%, primary label)
 *   ghost · link         → plain    (primary label, no fill)
 *
 * Pressing dims the whole button to 60% (UIKit highlight) instead of
 * swapping the fill; `pressed` (toggle) adds a tint fill to plain/tinted.
 */

const androidButtonVariants = cva(
  "flex-row items-center justify-center gap-2 rounded-md",
  {
    variants: {
      variant: {
        default: "bg-foreground active:bg-foreground/90",
        destructive: "bg-destructive active:bg-destructive/90",
        outline: "border border-input bg-transparent active:bg-state-hover",
        secondary: "bg-secondary active:bg-secondary/80",
        ghost: "active:bg-state-hover",
        link: "",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3",
        lg: "h-12 px-8",
        icon: "h-10 w-10",
      },
      pressed: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      { variant: "ghost", pressed: true, class: "bg-state-active" },
      { variant: "outline", pressed: true, class: "bg-state-active" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
      pressed: false,
    },
  },
);

const androidTextVariants = cva("font-medium", {
  variants: {
    variant: {
      default: "text-background",
      destructive: "text-destructive-foreground",
      outline: "text-foreground",
      secondary: "text-secondary-foreground",
      ghost: "text-foreground",
      link: "text-primary underline",
    },
    size: {
      default: "text-sm",
      sm: "text-xs",
      lg: "text-sm",
      icon: "text-sm",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export type ButtonVariant = NonNullable<
  VariantProps<typeof androidButtonVariants>["variant"]
>;
export type ButtonSize = NonNullable<
  VariantProps<typeof androidButtonVariants>["size"]
>;

type IosAppearance = "filled" | "filledDestructive" | "tinted" | "plain";

const IOS_APPEARANCE: Record<ButtonVariant, IosAppearance> = {
  default: "filled",
  destructive: "filledDestructive",
  outline: "tinted",
  secondary: "tinted",
  ghost: "plain",
  link: "plain",
};

const iosButtonVariants = cva(
  "flex-row items-center justify-center gap-2 rounded-full",
  {
    variants: {
      appearance: {
        filled: "bg-primary",
        filledDestructive: "bg-destructive",
        tinted: "",
        plain: "",
      },
      size: {
        default: "h-11 px-5",
        sm: "h-9 px-3.5",
        lg: "h-12 px-6",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      appearance: "filled",
      size: "default",
    },
  },
);

const iosTextVariants = cva("", {
  variants: {
    appearance: {
      filled: "font-semibold text-primary-foreground",
      filledDestructive: "font-semibold text-destructive-foreground",
      tinted: "font-semibold text-primary",
      plain: "text-primary",
    },
    size: {
      default: "text-base",
      sm: "text-sm",
      lg: "text-base",
      icon: "text-base",
    },
  },
  defaultVariants: {
    appearance: "filled",
    size: "default",
  },
});

export type { ButtonHaptic };

export interface ButtonProps
  extends
    Omit<PressableProps, "children" | "style" | "onPress">,
    Omit<VariantProps<typeof androidButtonVariants>, "pressed"> {
  /** A string renders as themed text; any other node renders as-is. */
  children?: ReactNode;
  /** Leading glyph (from ICON_MAP); trailing when `iconPosition="right"`. */
  icon?: IconName;
  iconPosition?: "left" | "right";
  /** Shows a spinner in place of the icon and disables the button. */
  loading?: boolean;
  /** Toggle-style pressed state (web `aria-pressed`). */
  pressed?: boolean;
  /**
   * iOS only: the color the tinted / plain appearances (`outline`,
   * `secondary`, `ghost`, `link`) use — the primary tint (default) or the
   * destructive red (a "Deny" / "Remove" that must not read as the primary
   * action). Android keeps its variant look.
   */
  tint?: "primary" | "destructive";
  /** Fire haptic feedback on press. */
  haptic?: ButtonHaptic | boolean;
  onPress?: () => void;
  className?: string;
}

const ANDROID_TEXT_TOKEN: Record<ButtonVariant, keyof NativeThemeTokens> = {
  default: "background",
  destructive: "destructiveForeground",
  outline: "foreground",
  secondary: "secondaryForeground",
  ghost: "foreground",
  link: "primary",
};

const IOS_TEXT_TOKEN: Record<IosAppearance, keyof NativeThemeTokens> = {
  filled: "primaryForeground",
  filledDestructive: "destructiveForeground",
  tinted: "primary",
  plain: "primary",
};

const ANDROID_ICON_SIZE: Record<ButtonSize, number> = {
  default: 18,
  sm: 16,
  lg: 20,
  icon: 20,
};

const IOS_ICON_SIZE: Record<ButtonSize, number> = {
  default: 20,
  sm: 16,
  lg: 20,
  icon: 22,
};

/** Tint fill alphas for the iOS `tinted` appearance (rest / toggled). */
const TINT_ALPHA = 0.15;
const TINT_ALPHA_PRESSED = 0.28;
/** UIKit highlight: the whole control dims while the finger is down. */
const PRESS_OPACITY = 0.6;

export function Button({
  variant: variantProp,
  size: sizeProp,
  children,
  icon,
  iconPosition = "left",
  loading = false,
  pressed = false,
  tint = "primary",
  haptic: hapticProp = false,
  disabled,
  onPress,
  onPressIn,
  onPressOut,
  className,
  accessibilityRole = "button",
  ...props
}: ButtonProps) {
  const variant = variantProp ?? "default";
  const size = sizeProp ?? "default";
  const { tokens } = useTheme();
  const [pressing, setPressing] = useState(false);
  const isDisabled = disabled || loading;
  const appearance = IOS_APPEARANCE[variant];
  // The tinted / plain appearances take the destructive red when asked.
  const iosTintable = appearance === "tinted" || appearance === "plain";
  const iosTintColor =
    tint === "destructive" ? tokens.destructive : tokens.primary;
  const contentColor = IS_IOS
    ? iosTintable && tint === "destructive"
      ? tokens.destructiveText
      : tokens[IOS_TEXT_TOKEN[appearance]]
    : tokens[ANDROID_TEXT_TOKEN[variant]];
  const glyph = loading ? (
    <Spinner size="small" color={contentColor} />
  ) : icon ? (
    <Icon
      name={icon}
      size={IS_IOS ? IOS_ICON_SIZE[size] : ANDROID_ICON_SIZE[size]}
      color={contentColor}
    />
  ) : null;

  const iosStyle = IS_IOS
    ? [
        { borderCurve: "continuous" as const },
        appearance === "tinted"
          ? {
              backgroundColor: withAlpha(
                iosTintColor,
                pressed ? TINT_ALPHA_PRESSED : TINT_ALPHA,
              ),
            }
          : appearance === "plain" && pressed
            ? { backgroundColor: withAlpha(iosTintColor, TINT_ALPHA) }
            : null,
        pressing ? { opacity: PRESS_OPACITY } : null,
      ]
    : undefined;

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: !!isDisabled, selected: pressed }}
      disabled={isDisabled}
      onPress={() => {
        // Honors the Settings → Haptics toggle (see @/lib/haptics).
        if (hapticProp) haptic(hapticKindForButton(hapticProp));
        onPress?.();
      }}
      onPressIn={(event) => {
        if (IS_IOS) setPressing(true);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        if (IS_IOS) setPressing(false);
        onPressOut?.(event);
      }}
      className={cn(
        IS_IOS
          ? iosButtonVariants({ appearance, size })
          : androidButtonVariants({ variant, size, pressed }),
        isDisabled && "opacity-50",
        className,
      )}
      style={iosStyle}
      {...props}
    >
      {iconPosition === "left" ? glyph : null}
      {typeof children === "string" ? (
        <Text
          className={cn(
            IS_IOS
              ? iosTextVariants({ appearance, size })
              : androidTextVariants({ variant, size }),
          )}
          style={
            IS_IOS && iosTintable && tint === "destructive"
              ? { color: tokens.destructiveText }
              : undefined
          }
          numberOfLines={1}
        >
          {children}
        </Text>
      ) : children != null ? (
        <View className="flex-row items-center gap-2">{children}</View>
      ) : null}
      {iconPosition === "right" ? glyph : null}
    </Pressable>
  );
}
