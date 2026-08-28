import type { ReactNode } from "react";
import { View } from "react-native";
import { z } from "zod";
import { cn } from "./cn";
import { Text } from "./Text";

export type PillVariant = "secondary" | "destructive" | "outline" | "emphasis";
export type PillSize = "default" | "sm";

const PILL_VARIANT_CLASS = {
  secondary: "border-transparent bg-secondary",
  destructive: "border-transparent bg-destructive",
  outline: "border-border bg-background",
  emphasis: "border-transparent bg-foreground",
} satisfies Record<PillVariant, string>;

const PILL_TEXT_CLASS = {
  secondary: "text-secondary-foreground",
  destructive: "text-destructive-foreground",
  outline: "text-foreground",
  emphasis: "text-background",
} satisfies Record<PillVariant, string>;

const PILL_SIZE_CLASS = {
  default: "px-2 py-0.5",
  sm: "px-1.5 py-0",
} satisfies Record<PillSize, string>;

export interface PillProps {
  variant: PillVariant;
  size?: PillSize;
  className?: string;
  children: ReactNode;
}

export function Pill({
  variant,
  size = "default",
  className,
  children,
}: PillProps) {
  const textChild = z.union([z.string(), z.number()]).safeParse(children);
  return (
    <View
      className={cn(
        "flex-row items-center self-start rounded border",
        PILL_SIZE_CLASS[size],
        PILL_VARIANT_CLASS[variant],
        className,
      )}
    >
      {textChild.success ? (
        <Text
          className={cn("text-xs", PILL_TEXT_CLASS[variant])}
          numberOfLines={1}
        >
          {textChild.data}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}
