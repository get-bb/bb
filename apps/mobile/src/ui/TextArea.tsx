import { forwardRef } from "react";
import { TextInput, type TextInputProps } from "react-native";
import { resolveFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { cn } from "./cn";

export interface TextAreaProps extends TextInputProps {
  invalid?: boolean;
  mono?: boolean;
  className?: string;
}

/** Multi-line text field. Mirrors packages/shared-ui textarea.tsx. */
export const TextArea = forwardRef<TextInput, TextAreaProps>(function TextArea(
  { invalid = false, editable = true, mono, className, style, ...props },
  ref,
) {
  const { tokens } = useTheme();
  const font = resolveFont({ className, mono });
  return (
    <TextInput
      ref={ref}
      multiline
      textAlignVertical="top"
      editable={editable}
      placeholderTextColor={tokens.mutedForeground}
      selectionColor={tokens.primary}
      cursorColor={tokens.primary}
      className={cn(
        "min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base text-foreground focus:border-ring",
        invalid && "border-destructive",
        !editable && "opacity-50",
        className,
      )}
      style={[font, style]}
      {...props}
    />
  );
});
