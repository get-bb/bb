import type { DiffProps } from "@get-bb/plugin-sdk";
import { DiffLoadingSkeleton } from "@/components/code/code-loading-skeletons";
import { defineSplit } from "@/lib/define-split";

export const PluginDiffSplit = defineSplit<DiffProps>({
  id: "plugin-diff",
  load: () => import("./PluginDiff").then((module) => module.PluginDiff),
  loading: () => <DiffLoadingSkeleton />,
  tier: "intent",
});
