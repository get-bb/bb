import type { ComponentProps } from "react";
import { resolveFont, useTheme } from "@/theme";
import { cn, SheetTextInput } from "@/ui";

interface SheetInputProps extends ComponentProps<typeof SheetTextInput> {
  invalid?: boolean;
  mono?: boolean;
  className?: string;
}

/**
 * The `Input` primitive's styling on `BottomSheetTextInput`, which keeps the
 * sheet's keyboard handling (interactive avoidance) working. Use this for
 * every text field that lives inside a `Sheet`.
 */
export function SheetInput({
  invalid = false,
  mono = false,
  editable = true,
  className,
  style,
  ...props
}: SheetInputProps) {
  const { tokens } = useTheme();
  return (
    <SheetTextInput
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
      style={[resolveFont({ className, mono }), style]}
      {...props}
    />
  );
}
