import { useEffect, useState, type ReactNode } from "react";

const LOADING_REVEAL_DELAY_MS = 200;

export function DelayedLoading({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setVisible(true),
      LOADING_REVEAL_DELAY_MS,
    );
    return () => window.clearTimeout(timeout);
  }, []);

  return visible ? children : null;
}
