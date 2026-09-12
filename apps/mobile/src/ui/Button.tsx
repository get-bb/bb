import { cva, type VariantProps } from "class-variance-authority";
import { useState, type ReactNode } from "react";
import { Pressable, View, type PressableProps } from "react-native";
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
        outline: "border border-input bg-transparent active:bg-state-hover",
        ghost: "active:bg-state-hover",
        link: "",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const androidTextVariants = cva("font-medium", {
  variants: {
    variant: {
      default: "text-background",
      outline: "text-foreground",
      ghost: "text-foreground",
      link: "text-primary underline",
    },
    size: {
      default: "text-sm",
      sm: "text-xs",
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

type IosAppearance = "filled" | "tinted" | "plain";

const IOS_APPEARANCE: Record<ButtonVariant, IosAppearance> = {
  default: "filled",
  outline: "tinted",
  ghost: "plain",
  link: "plain",
};

const iosButtonVariants = cva(
  "flex-row items-center justify-center gap-2 rounded-full",
  {
    variants: {
      appearance: {
        filled: "bg-primary",
        tinted: "",
        plain: "",
      },
      size: {
        default: "h-11 px-5",
        sm: "h-9 px-3.5",
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
      tinted: "font-semibold text-primary",
      plain: "text-primary",
    },
    size: {
      default: "text-base",
      sm: "text-sm",
    },
  },
  defaultVariants: {
    appearance: "filled",
    size: "default",
  },
});

export interface ButtonProps
  extends
    Omit<PressableProps, "children" | "style" | "onPress">,
    VariantProps<typeof androidButtonVariants> {
  children?: ReactNode;
  icon?: IconName;
  iconPosition?: "left" | "right";
  loading?: boolean;
  onPress?: () => void;
  className?: string;
}

const ANDROID_TEXT_TOKEN: Record<ButtonVariant, keyof NativeThemeTokens> = {
  default: "background",
  outline: "foreground",
  ghost: "foreground",
  link: "primary",
};

const IOS_TEXT_TOKEN: Record<IosAppearance, keyof NativeThemeTokens> = {
  filled: "primaryForeground",
  tinted: "primary",
  plain: "primary",
};

const ANDROID_ICON_SIZE: Record<ButtonSize, number> = {
  default: 18,
  sm: 16,
};

const IOS_ICON_SIZE: Record<ButtonSize, number> = {
  default: 20,
  sm: 16,
};

const TINT_ALPHA = 0.15;
const PRESS_OPACITY = 0.6;

export function Button({
  variant: variantProp,
  size: sizeProp,
  children,
  icon,
  iconPosition = "left",
  loading = false,
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
  const contentColor = IS_IOS
    ? tokens[IOS_TEXT_TOKEN[appearance]]
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
          ? { backgroundColor: withAlpha(tokens.primary, TINT_ALPHA) }
          : null,
        pressing ? { opacity: PRESS_OPACITY } : null,
      ]
    : undefined;

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: !!isDisabled, selected: false }}
      disabled={isDisabled}
      onPress={() => onPress?.()}
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
          : androidButtonVariants({ variant, size }),
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
