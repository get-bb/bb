import { useState } from "react";
import { View, type TextInputProps } from "react-native";
import { Button, Text } from "@/ui";
import { SheetInput } from "../pickers/SheetInput";

interface SheetNameFormProps {
  title: string;
  message?: string;
  initialValue: string;
  placeholder?: string;
  submitLabel: string;
  pending: boolean;
  /** Server-side error rendered under the field (name conflicts). */
  errorMessage?: string | null;
  autoCapitalize?: TextInputProps["autoCapitalize"];
  /** Receives the trimmed, non-empty name. */
  onSubmit: (name: string) => void;
  onCancel: () => void;
  /** Prefix for the input/submit test ids (`<prefix>-input`, `<prefix>-submit`). */
  testID: string;
}

/**
 * Single-field name form for bottom sheets (rename thread/project/section,
 * new section). Uses the sheet text field (`SheetInput`, the `Input` look
 * on `BottomSheetTextInput`) so the sheet rides above the keyboard; trims
 * and rejects empty names like the web RenameDialog. iOS offers the system
 * prompt (`promptName`) first; this is the fallback form.
 */
export function SheetNameForm({
  title,
  message,
  initialValue,
  placeholder,
  submitLabel,
  pending,
  errorMessage,
  autoCapitalize = "words",
  onSubmit,
  onCancel,
  testID,
}: SheetNameFormProps) {
  const [value, setValue] = useState(initialValue);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );
  const shownError = validationMessage ?? errorMessage ?? null;

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setValidationMessage("Enter a name.");
      return;
    }
    onSubmit(trimmed);
  };

  return (
    <View className="gap-3 px-4 pb-2 pt-1">
      <View className="gap-1">
        <Text variant="heading">{title}</Text>
        {message ? <Text variant="caption">{message}</Text> : null}
      </View>
      <SheetInput
        value={value}
        onChangeText={(next) => {
          setValue(next);
          if (validationMessage) setValidationMessage(null);
        }}
        placeholder={placeholder}
        autoFocus
        autoCapitalize={autoCapitalize}
        editable={!pending}
        invalid={shownError !== null}
        returnKeyType="done"
        onSubmitEditing={submit}
        selectTextOnFocus
        testID={`${testID}-input`}
      />
      {shownError ? (
        <Text
          variant="caption"
          tone="destructive"
          selectable
          testID={`${testID}-error`}
        >
          {shownError}
        </Text>
      ) : null}
      <View className="flex-row justify-end gap-2 pt-1">
        <Button variant="ghost" onPress={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button onPress={submit} loading={pending} testID={`${testID}-submit`}>
          {submitLabel}
        </Button>
      </View>
    </View>
  );
}
