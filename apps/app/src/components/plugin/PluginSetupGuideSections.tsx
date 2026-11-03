import type { ReactNode } from "react";
import type { InternalDoNotUseSetupFailureStage } from "@get-bb/plugin-sdk/app";
import { usePluginSlots } from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";

export function PluginSetupGuideSections({
  pluginId,
  onPhone,
  onSetupStarted,
  onSetupFailed,
  fallback,
}: {
  pluginId: string;
  onPhone: boolean;
  onSetupStarted: () => void;
  onSetupFailed: (stage: InternalDoNotUseSetupFailureStage) => void;
  fallback: ReactNode;
}) {
  const { setupGuideSections } = usePluginSlots();
  const sections = setupGuideSections.filter(
    (section) => section.pluginId === pluginId,
  );
  if (sections.length === 0) return fallback;
  return sections.map((section) => (
    <PluginSlotMount
      key={`${section.pluginId}/${section.id}/${section.generation}`}
      pluginId={section.pluginId}
      slotKind="setupGuideSection"
      slotId={section.id}
      crashFallback={fallback}
    >
      <section.component
        onPhone={onPhone}
        onSetupStarted={onSetupStarted}
        onSetupFailed={onSetupFailed}
      />
    </PluginSlotMount>
  ));
}
