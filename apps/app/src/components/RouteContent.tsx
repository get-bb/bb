import { Suspense, useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { markRouteContentPainted } from "@/lib/route-content-paint";
import { AppErrorBoundary } from "./AppErrorBoundary";

function PageLoadError() {
  useEffect(() => {
    markRouteContentPainted();
  }, []);

  return (
    <EmptyStatePanel role="alert" className="mx-auto my-6 w-full max-w-xl">
      <p>Couldn't load this page.</p>
      <p className="mt-2">Check your connection, then reload to try again.</p>
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => window.location.reload()}
      >
        Reload page
      </Button>
    </EmptyStatePanel>
  );
}

function renderPageLoadError(error: Error): ReactNode {
  if (
    !/^(Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS for)/.test(
      error.message,
    )
  ) {
    throw error;
  }
  return <PageLoadError />;
}

export function RouteContent({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <AppErrorBoundary resetKey={location.key} fallback={renderPageLoadError}>
      <Suspense fallback={null}>{children}</Suspense>
    </AppErrorBoundary>
  );
}
