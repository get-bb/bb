import { createHash } from "node:crypto";
import type { JsonValue } from "@bb/domain";
import { z } from "zod";
import type { AgentRuntimeBridgeLaunch } from "./types.js";

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const jsonObjectSchema: z.ZodType<Record<string, JsonValue>> = z.record(
  z.string(),
  jsonValueSchema,
);

function toStableJsonValue(value: JsonValue): JsonValue {
  if (
    value === null ||
    z.string().safeParse(value).success ||
    z.number().safeParse(value).success ||
    z.boolean().safeParse(value).success
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item));
  }
  const object = jsonObjectSchema.parse(value);
  return Object.fromEntries(
    Object.entries(object)
      .filter((entry) => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, toStableJsonValue(entryValue)]),
  );
}

function fingerprintStableJson(value: JsonValue): string {
  const parsedValue = jsonValueSchema.parse(value);
  return createHash("sha256")
    .update(JSON.stringify(toStableJsonValue(parsedValue)))
    .digest("hex")
    .slice(0, 16);
}

type BridgeLaunchProcessKeyInput = Pick<
  AgentRuntimeBridgeLaunch,
  "capabilities" | "providerOptions"
> & { source: Pick<AgentRuntimeBridgeLaunch["source"], "digest"> };

export function bridgeLaunchProcessKey(
  bridgeLaunch: BridgeLaunchProcessKeyInput,
): string {
  const fingerprintInput = jsonObjectSchema.parse({
    capabilities: bridgeLaunch.capabilities,
    providerOptions: bridgeLaunch.providerOptions,
  });
  return `${bridgeLaunch.source.digest.slice(0, 16)}.${fingerprintStableJson({
    ...fingerprintInput,
  })}`;
}
