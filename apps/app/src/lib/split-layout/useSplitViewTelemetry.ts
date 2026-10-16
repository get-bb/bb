import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { recordTelemetryEvent } from "@/components/onboarding/onboarding-telemetry";
import { splitLayoutAtom } from "./atoms";
import { countPanes } from "./ops";

export function useSplitViewTelemetry(): void {
  const layout = useAtomValue(splitLayoutAtom);
  const panes = layout === null ? 1 : countPanes(layout.root);
  const previousPanes = useRef(panes);
  useEffect(() => {
    if (panes > previousPanes.current && panes >= 2) {
      recordTelemetryEvent({
        name: "feature_used",
        properties: {
          feature: "split_view",
          feature_scope: "core",
          interaction: "opened",
          trigger: "unknown",
        },
      });
    }
    previousPanes.current = panes;
  }, [panes]);
}
