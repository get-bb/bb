import { lazy, Suspense, type ReactNode } from "react";

const NotificationMarkdown = lazy(() => import("./NotificationMarkdown"));

export function NotificationText({ children }: { children: ReactNode }) {
  if (typeof children !== "string") {
    return children;
  }
  return (
    <Suspense fallback={children}>
      <NotificationMarkdown>{children}</NotificationMarkdown>
    </Suspense>
  );
}
