import type { ComponentProps } from "react";
import {
  cn,
  SheetTextInput,
  useInputFieldProps,
  type InputFieldOptions,
} from "@/ui";

const IS_IOS = process.env.EXPO_OS === "ios";

interface SheetInputProps
  extends ComponentProps<typeof SheetTextInput>, InputFieldOptions {}

/**
 * The `Input` primitive's appearance on `BottomSheetTextInput`, which keeps
 * the sheet's keyboard handling (interactive avoidance) working. Use this
 * for every text field that lives inside a `Sheet`.
 */
export function SheetInput({
  invalid,
  mono,
  grouped,
  editable = true,
  className,
  style,
  ...props
}: SheetInputProps) {
  const field = useInputFieldProps({
    invalid,
    mono,
    grouped,
    editable,
    className: cn(IS_IOS ? "h-11" : "h-10", className),
  });
  return (
    <SheetTextInput
      editable={editable}
      autoComplete="off"
      autoCorrect={false}
      {...field}
      style={[field.style, style]}
      {...props}
    />
  );
}
