import { useCallback, useState } from "react";

interface UseNameValidationArgs {
  emptyMessage: string;
}

interface UseNameValidationResult {
  validationMessage: string | null;
  validate: (value: string) => string | null;
  clearMessage: () => void;
}

export function useNameValidation({
  emptyMessage,
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
      return trimmed;
    },
    [emptyMessage],
  );

  const clearMessage = useCallback(() => setValidationMessage(null), []);

  return { validationMessage, validate, clearMessage };
}
