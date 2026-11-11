import { useEffect } from "react";
import {
  useBbNavigate,
  useSdk,
  type PluginBrowserBbSdk,
} from "@get-bb/plugin-sdk/app";

export type Navigate = ReturnType<typeof useBbNavigate>;

interface AppBridge {
  sdk: PluginBrowserBbSdk;
  navigate: Navigate;
}

let current: AppBridge | null = null;
const threadSurfaces = new Map<string, Navigate[]>();

export function AppBridgeOverlay() {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  useEffect(() => {
    const bridge = { sdk, navigate };
    current = bridge;
    return () => {
      if (current === bridge) current = null;
    };
  }, [navigate, sdk]);
  return null;
}

export function useThreadSurfaceRegistration(threadId: string): void {
  const navigate = useBbNavigate();
  useEffect(() => {
    const list = threadSurfaces.get(threadId) ?? [];
    threadSurfaces.set(threadId, [...list, navigate]);
    return () => {
      const remaining = (threadSurfaces.get(threadId) ?? []).filter(
        (entry) => entry !== navigate,
      );
      if (remaining.length === 0) threadSurfaces.delete(threadId);
      else threadSurfaces.set(threadId, remaining);
    };
  }, [navigate, threadId]);
}

export function getAppBridge(): AppBridge {
  if (current === null) {
    throw new Error("Conductor layout is still loading. Try again.");
  }
  return current;
}

export function getThreadNavigate(threadId: string): Navigate {
  return threadSurfaces.get(threadId)?.at(-1) ?? getAppBridge().navigate;
}
