import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, type ReactNode } from "react";

const PluginGuide = lazy(() => import("./plugin-guide"));

export function LazyPluginGuide({
  initialSlideId,
  onSlideChange,
  serverContent,
}: {
  initialSlideId?: string;
  onSlideChange?: (slideId: string) => void;
  serverContent?: ReactNode;
}) {
  const placeholder = (
    <div aria-busy="true" className="min-h-96">
      {serverContent}
    </div>
  );
  return (
    <div className="app-theme">
      <ClientOnly fallback={placeholder}>
        <Suspense fallback={placeholder}>
          <PluginGuide
            initialSlideId={initialSlideId}
            onSlideChange={onSlideChange}
          />
        </Suspense>
      </ClientOnly>
    </div>
  );
}
