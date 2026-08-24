import { useEffect, useState } from "react";

/**
 * A clock that re-renders every `intervalMs` (default one minute) so relative
 * labels ("last seen 5m ago", "Checked 2m ago", "Resets in 25 min") cannot
 * sit on a stale value. Reading `Date.now()` during render is impure; this
 * keeps the read in state.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
