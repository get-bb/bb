import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import {
  usePluginSlots,
  type PluginMachineProviderInputsSlot,
} from "@/lib/plugin-slots";
import type { JsonValue } from "@bb/domain";
import type { PluginMachineProviderInputsChange } from "@get-bb/plugin-sdk";
import { useCallback, useState, type ReactNode } from "react";

export interface MachineProviderInputsDescriptor {
  id: string;
  displayName: string;
  pluginId: string;
  inputs: JsonValue | null;
  acceptsEmptyInputs: boolean;
}

interface ScopedMachineProviderInputsState {
  scopeKey: string;
  value: JsonValue | null;
  blockedReason: string | null;
}

const EMPTY_MACHINE_PROVIDER_INPUTS: JsonValue = {};

function findRegistration(
  provider: MachineProviderInputsDescriptor | null,
  slots: readonly PluginMachineProviderInputsSlot[],
): PluginMachineProviderInputsSlot | undefined {
  if (provider === null || provider.inputs === null) return undefined;
  return slots.find(
    (slot) =>
      slot.machineProviderId === provider.id &&
      slot.pluginId === provider.pluginId,
  );
}

export function useMachineProviderInputs({
  provider,
  initialValue,
  instanceId,
}: {
  provider: MachineProviderInputsDescriptor | null;
  initialValue?: JsonValue | null;
  instanceId: string;
}): {
  value: JsonValue | null;
  blockedReason: string | null;
  control: ReactNode;
} {
  const slots = usePluginSlots().machineProviderInputs;
  const registration = findRegistration(provider, slots);
  const scopeKey =
    provider === null
      ? ""
      : `${provider.pluginId}\0${provider.id}\0${JSON.stringify(initialValue ?? null)}`;
  const [state, setState] = useState<ScopedMachineProviderInputsState | null>(
    null,
  );
  const activeState = state?.scopeKey === scopeKey ? state : null;
  const defaultValue =
    provider?.inputs === null || provider === null
      ? null
      : initialValue !== undefined && initialValue !== null
        ? initialValue
        : provider.acceptsEmptyInputs
          ? EMPTY_MACHINE_PROVIDER_INPUTS
          : null;
  const value = activeState?.value ?? defaultValue;
  const reportCrash = useCallback(() => {
    if (provider === null) return;
    setState({
      scopeKey,
      value,
      blockedReason: `${provider.displayName} input control crashed.`,
    });
  }, [provider, scopeKey, value]);
  const handleChange = useCallback(
    (next: PluginMachineProviderInputsChange) => {
      setState((current) => {
        const currentValue =
          current?.scopeKey === scopeKey ? current.value : defaultValue;
        if (next.status === "blocked") {
          if (
            current?.scopeKey === scopeKey &&
            current.blockedReason === next.reason
          ) {
            return current;
          }
          return {
            scopeKey,
            value: currentValue,
            blockedReason: next.reason,
          };
        }
        if (
          current?.scopeKey === scopeKey &&
          current.blockedReason === null &&
          JSON.stringify(current.value) === JSON.stringify(next.value)
        ) {
          return current;
        }
        return { scopeKey, value: next.value, blockedReason: null };
      });
    },
    [defaultValue, scopeKey],
  );
  const blockedReason =
    provider === null || provider.inputs === null
      ? null
      : activeState?.blockedReason !== undefined
        ? activeState.blockedReason
        : registration === undefined && !provider.acceptsEmptyInputs
          ? `${provider.displayName} needs its plugin's control.`
          : value === null
            ? `Configure ${provider.displayName}.`
            : null;
  if (provider === null || registration === undefined) {
    return { value, blockedReason, control: null };
  }
  const InputsComponent = registration.component;
  return {
    value,
    blockedReason,
    control: (
      <PluginSlotMount
        pluginId={registration.pluginId}
        slotKind="machineProviderInputs"
        slotId={registration.machineProviderId}
        instanceId={instanceId}
        onCrash={reportCrash}
      >
        <InputsComponent value={value} onChange={handleChange} />
      </PluginSlotMount>
    ),
  };
}
