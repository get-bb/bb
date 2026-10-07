import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { appToast } from "@/components/ui/app-toast";
import { formatByteSize } from "@/lib/format-byte-size";
import { prunePluginCache } from "@/hooks/queries/plugin-settings-queries";

export function usePluginCachePruneCommand(): void {
  useAppCommandHandler("plugins.pruneCache", () => {
    void prunePluginCache(fetch).then(
      (result) => {
        appToast.success(
          result.removed.length === 0
            ? "Plugin cache is already clean"
            : `Freed ${formatByteSize(result.bytes)}`,
          {
            description:
              result.removed.length === 0
                ? "No installed plugin left unused versions behind."
                : `Deleted ${result.removed.length} unused cached plugin version${result.removed.length === 1 ? "" : "s"}.`,
          },
        );
      },
      (error: unknown) => {
        appToast.error("Failed to clean up plugin cache", {
          description: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return true;
  });
}
