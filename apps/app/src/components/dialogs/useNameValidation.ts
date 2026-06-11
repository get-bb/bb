import { useCallback, useState } from "react";

interface NameMaxLengthRule {
  limit: number;
  message: string;
}

interface UseNameValidationArgs {
  emptyMessage: string;
  /** Optional upper bound; omit when the name has no length cap. */
  maxLength?: NameMaxLengthRule;
}

interface UseNameValidationResult {
  validationMessage: string | null;
  /**
   * Trims `value` and returns it when valid, or null after surfacing the
   * relevant message (empty / too long).
   */
  validate: (value: string) => string | null;
  /** Clear the message; call from the field's onChange. */
  clearMessage: () => void;
}

/**
 * Shared name-field validation for the rename dialogs: trims, rejects empty
 * (and optionally over-long) input with a message, and clears it on edit.
 */
export function useNameValidation({
  emptyMessage,
  maxLength,
}: UseNameValidationArgs): UseNameValidationResult {
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );

  const validate = useCallback(
    (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) {
        setValidationMessage(emptyMessage);
        return null;
      }
      if (maxLength && trimmed.length > maxLength.limit) {
        setValidationMessage(maxLength.message);
        return null;
      }
      return trimmed;
    },
    [emptyMessage, maxLength],
  );

  const clearMessage = useCallback(() => setValidationMessage(null), []);

  return { validationMessage, validate, clearMessage };
}
