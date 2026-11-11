import { useMemo, type ReactNode } from "react";
import type { ExperimentalThreadHeaderTitleProps } from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import {
  usePluginSlots,
  type PluginThreadHeaderTitleSlot,
} from "@/lib/plugin-slots";

export function usePluginThreadHeaderTitleSlot(): PluginThreadHeaderTitleSlot | null {
  return usePluginSlots().threadHeaderTitles[0] ?? null;
}

interface PluginThreadHeaderTitleProps {
  slot: PluginThreadHeaderTitleSlot;
  threadId: string;
  projectId: string;
  environmentId: string | null;
  fallback: ReactNode;
}

export function PluginThreadHeaderTitle({
  slot,
  threadId,
  projectId,
  environmentId,
  fallback,
}: PluginThreadHeaderTitleProps) {
  const props = useMemo<ExperimentalThreadHeaderTitleProps>(
    () => ({
      threadId,
      projectId,
      environment: environmentId === null ? null : { id: environmentId },
    }),
    [environmentId, projectId, threadId],
  );
  const { pluginId, id, generation, component: Component } = slot;
  return (
    <PluginSlotMount
      key={`${pluginId}/${id}/${generation}/${threadId}`}
      pluginId={pluginId}
      slotKind="threadHeaderTitle"
      slotId={id}
      instanceId={threadId}
      crashFallback={fallback}
    >
      <Component {...props} />
    </PluginSlotMount>
  );
}
