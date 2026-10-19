import { useEffect, useRef, type ComponentProps } from "react";

export function BrowserAddressInput({
  onFocus,
  onBlur,
  ...props
}: Omit<ComponentProps<"input">, "onMouseDown" | "onMouseMove" | "onMouseUp">) {
  const addressClickStartRef = useRef<{ x: number; y: number } | null>(null);
  const didWindowBlurRef = useRef(false);
  useEffect(() => {
    const handleWindowBlur = () => {
      didWindowBlurRef.current = true;
      addressClickStartRef.current = null;
    };
    const handleKeyDown = () => {
      didWindowBlurRef.current = false;
    };
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);
  return (
    <input
      type="text"
      placeholder="Enter a URL"
      autoComplete="off"
      spellCheck={false}
      {...props}
      onMouseDown={(event) => {
        addressClickStartRef.current =
          event.button === 0 &&
          (didWindowBlurRef.current ||
            document.activeElement !== event.currentTarget)
            ? { x: event.clientX, y: event.clientY }
            : null;
        didWindowBlurRef.current = false;
      }}
      onMouseMove={(event) => {
        const start = addressClickStartRef.current;
        if (
          start !== null &&
          Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4
        ) {
          addressClickStartRef.current = null;
        }
      }}
      onMouseUp={(event) => {
        if (addressClickStartRef.current === null) return;
        addressClickStartRef.current = null;
        event.preventDefault();
        event.currentTarget.select();
      }}
      onFocus={(event) => {
        if (
          addressClickStartRef.current === null &&
          !didWindowBlurRef.current
        ) {
          event.currentTarget.select();
        }
        onFocus?.(event);
      }}
      onBlur={(event) => {
        addressClickStartRef.current = null;
        onBlur?.(event);
      }}
    />
  );
}
