import { defineSplit } from "@/lib/define-split";
import { SourceLoadingSkeleton } from "./code-loading-skeletons";
import type { BbSourceCodeProps } from "./code-rendering";

export const BbSourceCodeSplit = defineSplit<BbSourceCodeProps>({
  id: "bb-source-code",
  load: () => import("./BbSourceCode").then((module) => module.default),
  loading: () => <SourceLoadingSkeleton />,
  tier: "intent",
});
