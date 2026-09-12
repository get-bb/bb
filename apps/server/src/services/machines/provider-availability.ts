import { jsonValueSchema } from "@bb/domain";
import { z } from "zod";
import { decideWithinBox } from "../threads/dispatch-hooks.js";
import {
  invokeMachineProvider,
  machineProviderDecisionTimeoutMs,
  type PluginMachineProviderRecord,
} from "../plugins/plugin-machine-provider-registry.js";

const availabilitySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available") }).strict(),
  z
    .object({
      status: z.literal("setup-required"),
      message: z.string().min(1).max(500),
    })
    .strict(),
  z
    .object({
      status: z.literal("unavailable"),
      message: z.string().min(1).max(500),
    })
    .strict(),
]);

const emptyInputsCache = new WeakMap<
  PluginMachineProviderRecord["provider"],
  Promise<boolean>
>();

export function machineProviderAcceptsEmptyInputs(
  record: PluginMachineProviderRecord,
): Promise<boolean> {
  const cached = emptyInputsCache.get(record.provider);
  if (cached !== undefined) return cached;
  const resolved = resolveEmptyInputs(record);
  emptyInputsCache.set(record.provider, resolved);
  return resolved;
}

async function resolveEmptyInputs(
  record: PluginMachineProviderRecord,
): Promise<boolean> {
  const schema = record.provider.inputs;
  if (schema === null) return true;
  const invocation = await invokeMachineProvider(
    record,
    `"${record.provider.id}" machine provider empty inputs`,
    async () => schema["~standard"].validate({}),
  );
  if (!invocation.ok || invocation.value.issues !== undefined) return false;
  return jsonValueSchema.safeParse(invocation.value.value).success;
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
  const failure = !invocation.ok
    ? invocation.error
    : invocation.value.ok
      ? null
      : invocation.value.error;
  if (failure !== null) {
    return `Plugin "${record.pluginId}" could not determine availability: ${failure}`;
  }
  if (!invocation.ok || !invocation.value.ok) {
    return `Plugin "${record.pluginId}" could not determine availability.`;
  }
  const parsed = availabilitySchema.safeParse(invocation.value.value);
  if (!parsed.success) {
    return `Plugin "${record.pluginId}" returned an invalid availability result.`;
  }
  return parsed.data.status === "available" ? null : parsed.data.message;
}
