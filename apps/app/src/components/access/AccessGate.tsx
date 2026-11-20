import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { useAccessState } from "@/lib/access-state";
import { adoptNativeShellDeviceOnce } from "./native-device-adoption";

const LazyPairingScreen = lazy(() =>
  import("./PairingScreen").then((module) => ({
    default: module.PairingScreen,
  })),
);

export function AccessGate({ children }: { children: ReactNode }) {
  const access = useAccessState();
  useEffect(() => {
    if (access.signedIn) void adoptNativeShellDeviceOnce();
  }, [access.signedIn]);
  if (access.signedIn) return children;
  return (
    <Suspense fallback={null}>
      <LazyPairingScreen reason={access.reason} />
    </Suspense>
  );
}
