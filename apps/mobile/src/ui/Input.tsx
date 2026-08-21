import { forwardRef } from "react";
import { TextInput, type TextInputProps } from "react-native";
import { resolveFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { cn } from "./cn";

export interface InputProps extends TextInputProps {
  /** Paints the destructive border (validation error). */
  invalid?: boolean;
  /** Fira Code (URLs, codes, paths). */
  mono?: boolean;
  className?: string;
}

/**
 * Single-line text field. Mirrors packages/shared-ui input.tsx with the
 * coarse-pointer height (40) and `text-base` (16px, which also stops iOS
 * Safari-style zoom-on-focus semantics from mattering here).
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  { invalid = false, editable = true, mono, className, style, ...props },
  ref,
) {
  const { tokens } = useTheme();
  const font = resolveFont({ className, mono });
  return (
    <TextInput
      ref={ref}
      editable={editable}
      autoComplete="off"
      autoCorrect={false}
      placeholderTextColor={tokens.mutedForeground}
      selectionColor={tokens.primary}
      cursorColor={tokens.primary}
      className={cn(
        "h-10 w-full rounded-md border border-input bg-transparent px-3 text-base text-foreground focus:border-ring",
        invalid && "border-destructive",
        !editable && "opacity-50",
        className,
      )}
      style={[font, style]}
      {...props}
    />
  );
});
