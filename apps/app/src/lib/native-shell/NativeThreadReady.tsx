import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { getNativeShell } from "./native-shell";

export function NativeThreadReady({ threadId }: { threadId: string }) {
  const { pathname, search } = useLocation();

  useEffect(() => {
    const shell = getNativeShell();
    if (shell === null) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        shell.post({
          type: "thread-ready",
          threadId,
          path: `${pathname}${search}`,
        });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, search, threadId]);

  return null;
}
