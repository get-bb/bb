import { defineSplit } from "@/lib/define-split";
import { DiffLoadingSkeleton } from "./code-loading-skeletons";
import type { BbDiffProps } from "./code-rendering";

export const BbDiffSplit = defineSplit<BbDiffProps>({
  id: "bb-diff",
  load: () => import("./BbDiff").then((module) => module.default),
  loading: () => <DiffLoadingSkeleton />,
  tier: "intent",
});
