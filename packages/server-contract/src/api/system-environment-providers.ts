import { z } from "zod";
import { jsonValueSchema } from "@bb/domain";

const systemEnvironmentProviderAvailabilitySchema = z.discriminatedUnion(
  "status",
  [
    z.object({ status: z.literal("available") }),
    z.object({
      status: z.literal("setup-required"),
      message: z.string().min(1),
    }),
    z.object({
      status: z.literal("unavailable"),
      message: z.string().min(1),
    }),
  ],
);

export const systemEnvironmentProviderSchema = z.object({
  environmentProviderId: z.string().min(1).optional(),
  machineProviderId: z.string().min(1).nullable(),
  id: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1).nullable(),
  icon: z.string().min(1).nullable(),
  logoUrl: z.string().min(1).nullable(),
  pluginId: z.string().min(1),
  requires: z.object({
    projectCheckout: z.boolean(),
    gitCheckout: z.boolean(),
    gitRemote: z.boolean(),
    projectless: z.boolean(),
  }),
  inputs: jsonValueSchema.nullable(),
  acceptsEmptyInputs: z.boolean(),
  availability: systemEnvironmentProviderAvailabilitySchema.nullable(),
  machineAvailability: z.record(
    z.string().min(1),
    systemEnvironmentProviderAvailabilitySchema.nullable(),
  ),
  machineInputs: jsonValueSchema.nullable().optional(),
  machineAcceptsEmptyInputs: z.boolean().optional(),
  machineProviderPluginId: z.string().min(1).optional(),
});

export const systemEnvironmentProvidersResponseSchema = z.object({
  providers: z.array(systemEnvironmentProviderSchema),
});
