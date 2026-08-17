import { useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import { PluginReplacementSlot } from "@/components/plugin/PluginReplacementSlot";
import { useSidebar } from "@/components/ui/sidebar.js";
import { useRouteState } from "@/hooks/useRouteState";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import type { PluginThreadListSlot } from "@/lib/plugin-slots";

/** Shared by the mount and the host's crash check. */
export const THREAD_LIST_SLOT_KIND = "threadList";

interface PluginThreadListProps {
  replacement: ResolvedReplacement<PluginThreadListSlot>;
  /** BB's list bound to this sidebar instance. */
  original: ReactNode;
  /** The host search field's text; "" when closed or plugin-owned. */
  searchQuery: string;
  onNavigate: () => void;
}

/**
 * Mounts the active `experimental_threadList` slot in the sidebar's scroll
 * area, keyed by generation so a plugin reload remounts it with fresh
 * error-boundary state.
 */
export function PluginThreadList({
  replacement,
  original,
  searchQuery,
  onNavigate,
}: PluginThreadListProps) {
  const { projectId, threadId } = useRouteState();
  const { isCompactViewport } = useSidebar();
  const title =
    replacement.kind === "plugin" ? replacement.registration.title : "Plugin";

  const handleCrash = useCallback(
    (pluginId: string) => {
      toast.error("Sidebar plugin crashed", {
        description: `${title} (${pluginId}) stopped working, so bb's own thread list is back.`,
      });
    },
    [title],
  );

  return (
    <PluginReplacementSlot
      replacement={replacement}
      original={original}
      slotKind={THREAD_LIST_SLOT_KIND}
      onCrash={handleCrash}
    >
      {(slot, BoundOriginal) => (
        <slot.component
          activeThreadId={threadId ?? null}
          activeProjectId={projectId ?? null}
          isCompactViewport={isCompactViewport}
          onNavigate={onNavigate}
          searchQuery={searchQuery}
          experimental_Original={BoundOriginal}
        />
      )}
    </PluginReplacementSlot>
  );
}
