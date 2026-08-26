import type { SafeAreaInsets } from "@bb/mobile-bridge";
import { useEffect, useState } from "react";
import { getNativeShell, type NativeShell } from "./native-shell";

/**
 * React access to the shell. The bridge is installed before any page script
 * runs and never disappears, so the value is stable for the page's lifetime
 * and needs no context provider.
 */
export function useNativeShell(): NativeShell | null {
  return getNativeShell();
}

/**
 * The shell's safe-area insets, updated on rotation. Returns null in a plain
 * browser, where `env(safe-area-inset-*)` already works.
 */
export function useNativeSafeArea(): SafeAreaInsets | null {
  const shell = useNativeShell();
  const [insets, setInsets] = useState<SafeAreaInsets | null>(
    () => shell?.safeArea() ?? null,
  );
  useEffect(() => {
    if (shell === null) return;
    return shell.subscribe((event) => {
      if (event.type === "safe-area") setInsets(event.safeArea);
    });
  }, [shell]);
  return insets;
}

/**
 * Run a callback when the app returns to the foreground. WKWebView suspends
 * JavaScript in the background, so a socket that dropped while the phone slept
 * only learns about it here.
 */
export function useNativeShellResume(onResume: () => void): void {
  const shell = useNativeShell();
  useEffect(() => {
    if (shell === null) return;
    return shell.subscribe((event) => {
      if (event.type === "resume") onResume();
    });
  }, [onResume, shell]);
}
