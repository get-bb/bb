import { jsonValueSchema } from "@bb/domain";
import type { StandardSchemaV1 } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { PluginHookInvocation } from "../plugins/plugin-hook-registry.js";

const providerAvailabilitySchema = z.discriminatedUnion("status", [
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

type ProviderAvailabilityParseResult =
  | { ok: true; availability: z.infer<typeof providerAvailabilitySchema> }
  | { ok: false; message: string };

type ProviderInvoke = <T>(
  run: () => Promise<T>,
) => Promise<PluginHookInvocation<T>>;

export function parseProviderAvailabilityInvocation(
  pluginId: string,
  invocation: PluginHookInvocation<PluginHookInvocation<unknown>>,
): ProviderAvailabilityParseResult {
  const failure = !invocation.ok
    ? invocation.error
    : invocation.value.ok
      ? null
      : invocation.value.error;
  if (failure !== null) {
    return {
      ok: false,
      message: `Plugin "${pluginId}" could not determine availability: ${failure}`,
    };
  }
  if (!invocation.ok || !invocation.value.ok) {
    return {
      ok: false,
      message: `Plugin "${pluginId}" could not determine availability.`,
    };
  }
  const parsed = providerAvailabilitySchema.safeParse(invocation.value.value);
  if (!parsed.success) {
    return {
      ok: false,
      message: `Plugin "${pluginId}" returned an invalid availability result.`,
    };
  }
  return { ok: true, availability: parsed.data };
}

const emptyInputsCache = new WeakMap<object, Promise<boolean>>();

export function acceptsEmptyInputs(
  provider: { inputs: StandardSchemaV1 | null },
  invoke: ProviderInvoke,
): Promise<boolean> {
  const cached = emptyInputsCache.get(provider);
  if (cached !== undefined) return cached;
  const resolved = resolveEmptyInputs(provider, invoke);
  emptyInputsCache.set(provider, resolved);
  return resolved;
}

async function resolveEmptyInputs(
  provider: { inputs: StandardSchemaV1 | null },
  invoke: ProviderInvoke,
): Promise<boolean> {
  const schema = provider.inputs;
  if (schema === null) return true;
  const invocation = await invoke(async () => schema["~standard"].validate({}));
  if (!invocation.ok || invocation.value.issues !== undefined) return false;
  return jsonValueSchema.safeParse(invocation.value.value).success;
}
