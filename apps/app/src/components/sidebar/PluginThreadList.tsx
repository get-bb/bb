import { useCallback, useState } from "react";
import {
  PluginSlotMount,
  resetCrashedPluginSlots,
} from "@/components/plugin/PluginSlotMount";
import { useSidebar } from "@/components/ui/sidebar.js";
import { useRouteState } from "@/hooks/useRouteState";
import type { ExclusiveResolution } from "@/lib/plugin-replacement-preference";
import type { PluginThreadListSlot } from "@/lib/plugin-slots";
import { appToast } from "@/components/ui/app-toast";
import {
  usePluginFrontendLoadFailed,
  usePluginFrontendsSettled,
} from "@/lib/plugin-frontend-boot-state";
import { schedulePluginFrontendReconcile } from "@/lib/plugin-frontend-lazy";
import { ThreadListPlaceholder } from "./ThreadListPlaceholder";

const THREAD_LIST_SLOT_KIND = "threadList";

interface PluginThreadListProps {
  replacement: ExclusiveResolution<PluginThreadListSlot>;
  onNavigate: () => void;
}

export function PluginThreadList({
  replacement,
  onNavigate,
}: PluginThreadListProps) {
  const { projectId, threadId } = useRouteState();
  const { isCompactViewport } = useSidebar();
  const bootSettled = usePluginFrontendsSettled();
  const loadFailed = usePluginFrontendLoadFailed();
  const [attempt, setAttempt] = useState(0);
  const registration =
    replacement.kind === "plugin" ? replacement.registration : null;
  const fallback = replacement.kind === "plugin" ? replacement.fallback : null;
  const pluginId = registration?.pluginId ?? null;
  const title = registration?.title ?? "Thread list";

  const handleReload = useCallback(() => {
    if (pluginId !== null) resetCrashedPluginSlots(pluginId);
    setAttempt((current) => current + 1);
  }, [pluginId]);
  const handleCrash = useCallback(
    (crashedPluginId: string) => {
      appToast.error(`${title} crashed`, {
        description:
          fallback === null
            ? `The ${crashedPluginId} plugin's thread list stopped working.`
            : `The ${crashedPluginId} plugin's thread list stopped working; showing ${fallback.title} until you reload it.`,
        action: { label: "Reload", onClick: handleReload },
        duration: Number.POSITIVE_INFINITY,
      });
    },
    [fallback, handleReload, title],
  );

  if (registration === null) {
    return (
      <ThreadListPlaceholder
        state={
          replacement.kind === "loading" || !bootSettled
            ? { kind: "loading" }
            : loadFailed
              ? { kind: "failed", onRetry: schedulePluginFrontendReconcile }
              : { kind: "missing" }
        }
      />
    );
  }
  const listProps = {
    activeThreadId: threadId ?? null,
    activeProjectId: projectId ?? null,
    isCompactViewport,
    onNavigate,
    searchQuery: "",
  };
  const List = registration.component;
  const FallbackList = fallback?.component;
  const crashedPlaceholder = (
    <ThreadListPlaceholder
      state={{
        kind: "crashed",
        pluginTitle: title,
        onReload: handleReload,
      }}
    />
  );
  return (
    <PluginSlotMount
      key={`${registration.pluginId}/${registration.id}/${registration.generation}/${attempt}`}
      pluginId={registration.pluginId}
      slotKind={THREAD_LIST_SLOT_KIND}
      slotId={registration.id}
      crashFallback={
        fallback === null || FallbackList === undefined ? (
          crashedPlaceholder
        ) : (
          <PluginSlotMount
            key={`${fallback.pluginId}/${fallback.id}/${fallback.generation}`}
            pluginId={fallback.pluginId}
            slotKind={THREAD_LIST_SLOT_KIND}
            slotId={fallback.id}
            crashFallback={crashedPlaceholder}
          >
            <FallbackList {...listProps} />
          </PluginSlotMount>
        )
      }
      onCrash={handleCrash}
    >
      <List {...listProps} />
    </PluginSlotMount>
  );
}
