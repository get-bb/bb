import type { ComponentType, ReactNode } from "react";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import { PluginSlotMount } from "./PluginSlotMount";

interface PluginReplacementRegistration {
  id: string;
  pluginId: string;
  generation: number;
}

/**
 * Mount one exclusive provider with an instance-bound owner renderer.
 * `Original` bypasses resolution, so plugin delegation and crash fallback
 * cannot recurse into the selected provider.
 */
export function PluginReplacementSlot<
  Registration extends PluginReplacementRegistration,
>({
  children,
  onCrash,
  Original,
  replacement,
  slotKind,
}: {
  children: (registration: Registration, Original: ComponentType) => ReactNode;
  onCrash?: (pluginId: string) => void;
  Original: ComponentType;
  replacement: ResolvedReplacement<Registration>;
  slotKind: string;
}) {
  if (replacement.kind === "owner") return <Original />;

  const registration = replacement.registration;
  return (
    <PluginSlotMount
      key={`${registration.pluginId}/${registration.id}/${registration.generation}`}
      pluginId={registration.pluginId}
      slotKind={slotKind}
      slotId={registration.id}
      crashFallback={<Original />}
      {...(onCrash === undefined ? {} : { onCrash })}
    >
      {children(registration, Original)}
    </PluginSlotMount>
  );
}
