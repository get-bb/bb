import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { shellReportPath, shellReportReady, useNativeShell } from ".";

/**
 * Tells the mobile shell what the page is doing: that it painted, and which
 * route it is on. The shell uses the first to drop its own loading state and
 * the second to reopen the same place after a cold start.
 *
 * Renders nothing and does nothing in a plain browser. Mount once inside the
 * router.
 */
export function NativeShellReporter() {
  const shell = useNativeShell();
  const location = useLocation();
  const path = `${location.pathname}${location.search}`;
  const hasReportedReady = useRef(false);

  useEffect(() => {
    if (shell === null || hasReportedReady.current) return;
    hasReportedReady.current = true;
    shellReportReady(path);
  }, [path, shell]);

  useEffect(() => {
    if (shell === null) return;
    shellReportPath(document.title, path);
  }, [path, shell]);

  return null;
}
