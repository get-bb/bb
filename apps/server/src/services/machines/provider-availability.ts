import { decideWithinBox } from "../threads/dispatch-hooks.js";
import {
  acceptsEmptyInputs,
  parseProviderAvailabilityInvocation,
} from "../lib/provider-availability.js";
import {
  invokeMachineProvider,
  machineProviderDecisionTimeoutMs,
  type PluginMachineProviderRecord,
} from "../plugins/plugin-machine-provider-registry.js";

export function machineProviderAcceptsEmptyInputs(
  record: PluginMachineProviderRecord,
): Promise<boolean> {
  return acceptsEmptyInputs(record.provider, (run) =>
    invokeMachineProvider(
      record,
      `"${record.provider.id}" machine provider empty inputs`,
      run,
    ),
  );
}

export async function machineProviderUnavailableReason(
  record: PluginMachineProviderRecord,
): Promise<string | null> {
  const availability = record.provider.availability;
  if (availability === null) return null;
  const invocation = await invokeMachineProvider(
    record,
    `"${record.provider.id}" machine provider availability`,
    () =>
      decideWithinBox(
        () => Promise.resolve(availability()),
        machineProviderDecisionTimeoutMs(),
      ),
  );
  const resolution = parseProviderAvailabilityInvocation(
    record.pluginId,
    invocation,
  );
  if (!resolution.ok) return resolution.message;
  return resolution.availability.status === "available"
    ? null
    : resolution.availability.message;
}
