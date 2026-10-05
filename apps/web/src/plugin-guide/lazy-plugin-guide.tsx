import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const PluginGuide = lazy(() => import("./plugin-guide"));

export function LazyPluginGuide({
  initialSlideId,
  onSlideChange,
}: {
  initialSlideId?: string;
  onSlideChange?: (slideId: string) => void;
}) {
  const placeholder = <div aria-busy="true" className="min-h-96" />;
  return (
    <ClientOnly fallback={placeholder}>
      <Suspense fallback={placeholder}>
        <PluginGuide
          initialSlideId={initialSlideId}
          onSlideChange={onSlideChange}
        />
      </Suspense>
    </ClientOnly>
  );
}
