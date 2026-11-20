import { useRequirePierreWorkerPool } from "@/lib/pierre-worker-pool-gate";
import { useEffect } from "react";
import { BbDiffSplit } from "./BbDiffSplit";
import { BbSourceCodeSplit } from "./BbSourceCodeSplit";
import { useDiffRendererReplacement } from "./codeRendererProvider";

export function useDiffRendererLoad(): void {
  const builtin = useDiffRendererReplacement().kind === "owner";
  useRequirePierreWorkerPool(builtin);
  useEffect(() => {
    if (builtin) void BbDiffSplit.preload();
  }, [builtin]);
}

export function useSourceCodeRendererLoad(): void {
  useRequirePierreWorkerPool(true);
  useEffect(() => {
    void BbSourceCodeSplit.preload();
  }, []);
}
