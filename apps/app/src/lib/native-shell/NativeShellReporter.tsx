import type { ShellWindowLayout } from "@bb/mobile-bridge";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  getNativeShell,
  shellReportPath,
  shellReportReady,
} from "./native-shell";

const VERTICAL_BAR_ATTRIBUTE = "data-bb-native-vertical-bar";
const VERTICAL_BAR_EDGE_ATTRIBUTE = "data-bb-native-vertical-bar-edge";

export function NativeShellReporter() {
  const shell = getNativeShell();
  const location = useLocation();
  const path = `${location.pathname}${location.search}`;
  const hasReportedReady = useRef(false);

  useEffect(() => {
    if (shell === null || !shell.has("safe-area")) return;
    const style = document.documentElement.style;
    const applyBottomInset = (bottom: number) => {
      style.setProperty("--bb-safe-area-bottom", `${bottom}px`);
    };
    applyBottomInset(shell.safeArea().bottom);
    const unsubscribe = shell.subscribe((event) => {
      if (event.type === "safe-area") applyBottomInset(event.safeArea.bottom);
    });
    return () => {
      unsubscribe();
      style.removeProperty("--bb-safe-area-bottom");
    };
  }, [shell]);

  useEffect(() => {
    if (shell === null) return;
    const root = document.documentElement;
    const applyWindowLayout = (layout: ShellWindowLayout | null) => {
      if (layout === null) {
        root.removeAttribute(VERTICAL_BAR_ATTRIBUTE);
        root.removeAttribute(VERTICAL_BAR_EDGE_ATTRIBUTE);
        return;
      }
      root.setAttribute(VERTICAL_BAR_ATTRIBUTE, layout.verticalBar.behavior);
      root.setAttribute(VERTICAL_BAR_EDGE_ATTRIBUTE, layout.verticalBar.edge);
    };
    applyWindowLayout(shell.windowLayout());
    const unsubscribe = shell.subscribe((event) => {
      if (event.type === "window-layout") applyWindowLayout(event.windowLayout);
    });
    return () => {
      unsubscribe();
      applyWindowLayout(null);
    };
  }, [shell]);

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
