import { z } from "zod";

export const deviceSetupSourceSchema = z.enum([
  "first_run",
  "replay",
  "settings",
  "cli",
  "other",
  "unknown",
]);
export type DeviceSetupSource = z.infer<typeof deviceSetupSourceSchema>;

const errorCategorySchema = z.enum([
  "request",
  "authentication",
  "transport",
  "enrollment",
  "unknown",
]);
export function deviceTelemetryContext(source: DeviceSetupSource) {
  return source === "first_run" || source === "replay"
    ? { surface: "onboarding" as const, entry: source }
    : { surface: source, entry: null };
}

const deviceContextFields = {
  surface: z.enum(["onboarding", "settings", "cli", "other", "unknown"]),
  entry: z.enum(["first_run", "replay"]).nullable(),
  step: z.literal("devices"),
  resource_type: z.literal("device"),
};

export const deviceOperationPropertiesSchema = z
  .object({
    ...deviceContextFields,
    resource_id: z.enum(["browser_access", "additional_machine"]),
    operation: z.enum(["enable", "enroll"]),
    outcome: z.enum(["started", "succeeded", "failed", "cancelled", "unknown"]),
    error_category: errorCategorySchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.resource_id === "browser_access") !==
      (value.operation === "enable")
    )
      context.addIssue({
        code: "custom",
        message: "Operation must match device category",
      });
    if (
      (value.outcome === "failed" || value.outcome === "unknown") !==
      (value.error_category !== null)
    )
      context.addIssue({
        code: "custom",
        message: "Error category must match operation outcome",
      });
    if ((value.surface === "onboarding") !== (value.entry !== null))
      context.addIssue({
        code: "custom",
        message: "Entry belongs to onboarding",
      });
  });

export const deviceStatePropertiesSchema = z
  .discriminatedUnion("resource_id", [
    z
      .object({
        ...deviceContextFields,
        resource_id: z.enum(["browser_access", "additional_machine"]),
        state: z.enum(["setup_open", "connected"]),
      })
      .strict(),
    z
      .object({
        ...deviceContextFields,
        resource_id: z.literal("mobile"),
        state: z.literal("download_requested"),
        platform: z.enum(["ios", "android"]),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if ((value.surface === "onboarding") !== (value.entry !== null))
      context.addIssue({
        code: "custom",
        message: "Entry belongs to onboarding",
      });
    if (
      value.resource_id === "additional_machine" &&
      value.state === "connected"
    )
      context.addIssue({
        code: "custom",
        message: "Machine work is measured at execution",
      });
  });

export const deviceStateTelemetrySchema = z
  .object({
    name: z.literal("onboarding_step_state"),
    properties: deviceStatePropertiesSchema,
  })
  .strict();

export const serverDeviceSetupTelemetrySchema = z.discriminatedUnion("name", [
  z
    .object({
      name: z.literal("onboarding_operation"),
      properties: deviceOperationPropertiesSchema,
    })
    .strict(),
  deviceStateTelemetrySchema,
]);
export type DeviceSetupEvent = z.infer<typeof serverDeviceSetupTelemetrySchema>;

export const clientDeviceStatePropertiesSchema =
  deviceStatePropertiesSchema.refine(
    (value) => value.resource_id === "mobile" || value.state === "setup_open",
    { message: "Connection observations are server-owned" },
  );
export const deviceSetupTelemetrySchema = deviceStateTelemetrySchema.extend({
  properties: clientDeviceStatePropertiesSchema,
});

export type DeviceOperationProperties = z.infer<
  typeof deviceOperationPropertiesSchema
>;
export const connectDeviceSetupPropertiesSchema =
  deviceOperationPropertiesSchema.refine(
    (value) =>
      value.resource_id === "browser_access" && value.operation === "enable",
    { message: "Connect only reports browser enable attempts" },
  );
export type ConnectDeviceSetupProperties = z.infer<
  typeof connectDeviceSetupPropertiesSchema
>;
