import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(() => value);

  useEffect(() => {
    if (Object.is(value, debouncedValue)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(() => value);
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [debouncedValue, delayMs, value]);

  return debouncedValue;
}
