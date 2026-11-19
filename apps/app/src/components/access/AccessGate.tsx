import { lazy, Suspense, type ReactNode } from "react";
import { useAccessState } from "@/lib/access-state";

const LazyPairingScreen = lazy(() =>
  import("./PairingScreen").then((module) => ({
    default: module.PairingScreen,
  })),
);

export function AccessGate({ children }: { children: ReactNode }) {
  const access = useAccessState();
  if (access.signedIn) return children;
  return (
    <Suspense fallback={null}>
      <LazyPairingScreen reason={access.reason} />
    </Suspense>
  );
}
