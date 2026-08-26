import { Alert } from "react-native";
import type { NamePromptOptions } from "./name-prompt-types";

/**
 * iOS: the system alert with a text field (Cancel + the submit button), the
 * native home of "rename this". Metro picks this file on iOS;
 * `name-prompt.ts` is the fallback that asks the caller for a sheet form.
 */
export function promptName({
  title,
  message,
  initialValue,
  submitLabel,
  onSubmit,
  onCancel,
}: NamePromptOptions): boolean {
  Alert.prompt(
    title,
    message,
    [
      { text: "Cancel", style: "cancel", onPress: () => onCancel?.() },
      {
        text: submitLabel,
        onPress: (value?: string) => {
          const name = value?.trim();
          if (name) onSubmit(name);
          else onCancel?.();
        },
      },
    ],
    "plain-text",
    initialValue,
  );
  return true;
}

export type { NamePromptOptions } from "./name-prompt-types";
