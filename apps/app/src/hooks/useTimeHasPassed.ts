import { useEffect, useState } from "react";

const MAX_TIMEOUT_MS = 2_147_483_647;

export function useTimeHasPassed(atMs: number | null): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (atMs === null || now >= atMs) return;
    const timeout = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, Math.min(atMs - Date.now(), MAX_TIMEOUT_MS)),
    );
    return () => clearTimeout(timeout);
  }, [atMs, now]);
  return atMs !== null && now >= atMs;
}
