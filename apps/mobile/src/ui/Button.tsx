import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { Pressable, View, type PressableProps } from "react-native";
import { haptic, hapticKindForButton, type ButtonHaptic } from "@/lib/haptics";
import { useTheme } from "@/theme/ThemeProvider";
import type { NativeThemeTokens } from "@/theme/theme.native";
import { cn } from "./cn";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./Spinner";
import { Text } from "./Text";

/*
 * Mirrors packages/shared-ui/src/components/ui/button.tsx (variant and size
 * names), with the coarse-pointer heights as the base: default 40, sm 36,
 * lg 48, icon 40×40. `active:` replaces web `hover:`.
 */
const buttonVariants = cva(
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

const buttonTextVariants = cva("font-medium", {
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
  VariantProps<typeof buttonVariants>["variant"]
>;
export type ButtonSize = NonNullable<
  VariantProps<typeof buttonVariants>["size"]
>;

export type { ButtonHaptic };

export interface ButtonProps
  extends
    Omit<PressableProps, "children" | "style" | "onPress">,
    Omit<VariantProps<typeof buttonVariants>, "pressed"> {
  /** A string renders as themed text; any other node renders as-is. */
  children?: ReactNode;
  /** Leading glyph (from ICON_MAP); trailing when `iconPosition="right"`. */
  icon?: IconName;
  iconPosition?: "left" | "right";
  /** Shows a spinner in place of the icon and disables the button. */
  loading?: boolean;
  /** Toggle-style pressed state (web `aria-pressed`). */
  pressed?: boolean;
  /** Fire haptic feedback on press. */
  haptic?: ButtonHaptic | boolean;
  onPress?: () => void;
  className?: string;
}

const TEXT_TOKEN: Record<ButtonVariant, keyof NativeThemeTokens> = {
  default: "background",
  destructive: "destructiveForeground",
  outline: "foreground",
  secondary: "secondaryForeground",
  ghost: "foreground",
  link: "primary",
};

const ICON_SIZE: Record<ButtonSize, number> = {
  default: 18,
  sm: 16,
  lg: 20,
  icon: 20,
};

export function Button({
  variant: variantProp,
  size: sizeProp,
  children,
  icon,
  iconPosition = "left",
  loading = false,
  pressed = false,
  haptic: hapticProp = false,
  disabled,
  onPress,
  className,
  accessibilityRole = "button",
  ...props
}: ButtonProps) {
  const variant = variantProp ?? "default";
  const size = sizeProp ?? "default";
  const { tokens } = useTheme();
  const isDisabled = disabled || loading;
  const contentColor = tokens[TEXT_TOKEN[variant]];
  const glyph = loading ? (
    <Spinner size="small" color={contentColor} />
  ) : icon ? (
    <Icon name={icon} size={ICON_SIZE[size]} color={contentColor} />
  ) : null;

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
      className={cn(
        buttonVariants({ variant, size, pressed }),
        isDisabled && "opacity-50",
        className,
      )}
      {...props}
    >
      {iconPosition === "left" ? glyph : null}
      {typeof children === "string" ? (
        <Text
          className={cn(buttonTextVariants({ variant, size }))}
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
