import { forwardRef } from "react";
import {
  StyleSheet,
  TextInput,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
} from "react-native";
import { resolveFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { cn } from "./cn";

const IS_IOS = process.env.EXPO_OS === "ios";

/** iOS text-field corner radius (grouped cells and search fields). */
export const INPUT_RADIUS = 10;

export interface InputFieldOptions {
  /** Paints the destructive border (validation error). */
  invalid?: boolean;
  /** Mono face (URLs, codes, paths). */
  mono?: boolean;
  /**
   * The field sits inside a grouped card (`GroupedSection`): it takes the
   * cell color instead of the `muted` fill so it reads as part of the cell.
   */
  grouped?: boolean;
  editable?: boolean;
  className?: string;
}

export interface InputFieldProps {
  className: string;
  style: StyleProp<TextStyle>;
  placeholderTextColor: string;
  selectionColor: string;
  cursorColor: string;
  keyboardAppearance: "light" | "dark";
  clearButtonMode?: TextInputProps["clearButtonMode"];
}

/**
 * The props every text field in the app shares, so `Input`, `TextArea` and
 * the sheet-hosted `SheetInput` render identically. iOS: the grouped field
 * look — filled (`muted` or the grouped cell), no border, radius 10 with
 * continuous corners, 17pt system font, tertiary placeholder, a clear
 * button while editing; invalid = destructive hairline. Android: the
 * bordered web field (`border-input`, focus ring).
 */
export function useInputFieldProps({
  invalid = false,
  mono,
  grouped = false,
  editable = true,
  className,
}: InputFieldOptions): InputFieldProps {
  const { tokens, mode } = useTheme();
  const font = resolveFont({ className, mono });
  if (IS_IOS) {
    return {
      className: cn(
        "w-full px-3 text-base text-foreground",
        grouped ? "bg-surface-grouped-cell" : "bg-muted",
        !editable && "opacity-50",
        className,
      ),
      style: [
        font,
        { borderRadius: INPUT_RADIUS, borderCurve: "continuous" },
        invalid
          ? {
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: tokens.destructive,
            }
          : null,
      ],
      placeholderTextColor: tokens.subtleForeground,
      selectionColor: tokens.primary,
      cursorColor: tokens.primary,
      keyboardAppearance: mode,
      clearButtonMode: "while-editing",
    };
  }
  return {
    className: cn(
      "w-full rounded-md border border-input bg-transparent px-3 text-base text-foreground focus:border-ring",
      invalid && "border-destructive",
      !editable && "opacity-50",
      className,
    ),
    style: font,
    placeholderTextColor: tokens.mutedForeground,
    selectionColor: tokens.primary,
    cursorColor: tokens.primary,
    keyboardAppearance: mode,
  };
}

export interface InputProps extends TextInputProps, InputFieldOptions {}

/** Single-line text field: 44pt on iOS, 40 on Android. */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  { invalid, editable = true, mono, grouped, className, style, ...props },
  ref,
) {
  const field = useInputFieldProps({
    invalid,
    mono,
    grouped,
    editable,
    className: cn(IS_IOS ? "h-11" : "h-10", className),
  });
  return (
    <TextInput
      ref={ref}
      editable={editable}
      autoComplete="off"
      autoCorrect={false}
      {...field}
      style={[field.style, style]}
      {...props}
    />
  );
});
