import { BbDiffSplit } from "@/components/code/BbDiffSplit";
import { BbSourceCodeSplit } from "@/components/code/BbSourceCodeSplit";
import { useEffect } from "react";
import {
  useDiffRendererReplacement,
  useSourceCodeRendererReplacement,
} from "@/components/code/codeRendererProvider";
import { usePluginFrontendBootComplete } from "@/lib/plugin-frontend-boot-state";
import { queueSplitPreload } from "@/lib/split-prefetch";

export function useCodeRendererPreloads(): void {
  const bootComplete = usePluginFrontendBootComplete();
  const warmDiff = useDiffRendererReplacement().kind === "owner";
  const warmSource = useSourceCodeRendererReplacement().kind === "owner";

  useEffect(() => {
    if (!bootComplete || (!warmDiff && !warmSource)) return;
    let cancelled = false;
    queueSplitPreload(async () => {
      if (cancelled) return;
      await Promise.all([
        warmDiff ? BbDiffSplit.preload() : undefined,
        warmSource ? BbSourceCodeSplit.preload() : undefined,
      ]).catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [bootComplete, warmDiff, warmSource]);
}
