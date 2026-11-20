import { useRequirePierreWorkerPool } from "@/lib/pierre-worker-pool-gate";
import { useEffect } from "react";
import { BbDiffSplit } from "./BbDiffSplit";
import { BbSourceCodeSplit } from "./BbSourceCodeSplit";
import {
  useDiffRendererReplacement,
  useSourceCodeRendererReplacement,
} from "./codeRendererProvider";

export function useDiffRendererLoad(): void {
  const builtin = useDiffRendererReplacement().kind === "owner";
  useRequirePierreWorkerPool(builtin);
  useEffect(() => {
    if (builtin) void BbDiffSplit.preload();
  }, [builtin]);
}

export function useSourceCodeRendererLoad(): void {
  const builtin = useSourceCodeRendererReplacement().kind === "owner";
  useRequirePierreWorkerPool(builtin);
  useEffect(() => {
    if (builtin) void BbSourceCodeSplit.preload();
  }, [builtin]);
}
