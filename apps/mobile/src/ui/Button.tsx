import { cva, type VariantProps } from "class-variance-authority";
import { useState, type ReactNode } from "react";
import { Pressable, View, type PressableProps } from "react-native";
import { z } from "zod";
import { haptic, hapticKindForButton, type ButtonHaptic } from "@/lib/haptics";
import { withAlpha } from "@/theme/colors";
import { useTheme } from "@/theme/ThemeProvider";
import type { NativeThemeTokens } from "@/theme/theme.native";
import { cn } from "./cn";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./Spinner";
import { Text } from "./Text";

const IS_IOS = process.env.EXPO_OS === "ios";

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

const IOS_APPEARANCE = {
  default: "filled",
  destructive: "filledDestructive",
  outline: "tinted",
  secondary: "tinted",
  ghost: "plain",
  link: "plain",
} satisfies Record<ButtonVariant, IosAppearance>;

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
  children?: ReactNode;
  icon?: IconName;
  iconPosition?: "left" | "right";
  loading?: boolean;
  pressed?: boolean;
  tint?: "primary" | "destructive";
  haptic?: ButtonHaptic | boolean;
  onPress?: () => void;
  className?: string;
}

const ANDROID_TEXT_TOKEN = {
  default: "background",
  destructive: "destructiveForeground",
  outline: "foreground",
  secondary: "secondaryForeground",
  ghost: "foreground",
  link: "primary",
} satisfies Record<ButtonVariant, keyof NativeThemeTokens>;

const IOS_TEXT_TOKEN = {
  filled: "primaryForeground",
  filledDestructive: "destructiveForeground",
  tinted: "primary",
  plain: "primary",
} satisfies Record<IosAppearance, keyof NativeThemeTokens>;

const ANDROID_ICON_SIZE = {
  default: 18,
  sm: 16,
  lg: 20,
  icon: 20,
} satisfies Record<ButtonSize, number>;

const IOS_ICON_SIZE = {
  default: 20,
  sm: 16,
  lg: 20,
  icon: 22,
} satisfies Record<ButtonSize, number>;

const TINT_ALPHA = 0.15;
const TINT_ALPHA_PRESSED = 0.28;
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
  const textChild = z.string().safeParse(children);
  const isDisabled = disabled || loading;
  const appearance = IOS_APPEARANCE[variant];
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
      {textChild.success ? (
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
          {textChild.data}
        </Text>
      ) : children != null ? (
        <View className="flex-row items-center gap-2">{children}</View>
      ) : null}
      {iconPosition === "right" ? glyph : null}
    </Pressable>
  );
}
