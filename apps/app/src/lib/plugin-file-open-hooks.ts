import type { ExperimentalLiveFileTarget } from "@get-bb/plugin-sdk";
import { useLiveFileOpenTargets } from "@/hooks/useLiveFileOpenTargets";
import { normalizeExperimentalLiveFileTarget } from "@/lib/live-file-navigation";

export function usePluginCanOpenFileExternally(
  target: ExperimentalLiveFileTarget,
): boolean {
  return useLiveFileOpenTargets(normalizeExperimentalLiveFileTarget(target))
    .canOpenExternally;
}
