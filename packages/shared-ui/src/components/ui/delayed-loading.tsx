import { useEffect, useState, type ReactNode } from "react";

export const DEFAULT_LOADING_REVEAL_DELAY_MS = 200;

/**
 * Defers a loading fallback long enough for quick requests to settle without
 * flashing transient UI. Mount this component only while the request is
 * loading so unmounting cancels the pending reveal.
 */
export function DelayedLoading({
  children,
  delayMs = DEFAULT_LOADING_REVEAL_DELAY_MS,
}: {
  children: ReactNode;
  delayMs?: number;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs]);

  return visible ? children : null;
}
