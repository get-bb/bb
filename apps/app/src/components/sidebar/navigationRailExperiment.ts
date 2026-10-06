import { useEffect, useState } from "react";
import { z } from "zod";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { createLastKnownCache } from "@/lib/last-known-cache";

const layoutCache = createLastKnownCache({
  prefix: "bb.navigation-rail-layout",
  version: "1",
  schema: z.boolean(),
});

export function useNavigationRailExperiment(): boolean {
  const navigationRail = useSystemConfig().data?.experiments.navigationRail;
  const [rememberedLayout] = useState(() =>
    layoutCache.read(layoutCache.key()),
  );
  useEffect(() => {
    if (navigationRail !== undefined) {
      layoutCache.write(layoutCache.key(), navigationRail);
    }
  }, [navigationRail]);
  return navigationRail ?? rememberedLayout ?? false;
}
