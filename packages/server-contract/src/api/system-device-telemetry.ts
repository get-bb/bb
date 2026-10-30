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
const failure = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.enum(["failed", "unknown"]),
    error_category: errorCategorySchema,
  }),
  z.object({ outcome: z.literal("cancelled"), error_category: z.null() }),
]);
const setupFields = {
  outcome: z.enum([
    "observed",
    "started",
    "succeeded",
    "failed",
    "cancelled",
    "unknown",
  ]),
  source: deviceSetupSourceSchema,
  error_category: errorCategorySchema.nullable(),
};
const browser = z.enum([
  "setup_opened",
  "enable_requested",
  "service_ready",
  "remote_connected",
  "setup_result",
]);
const machine = z.enum([
  "setup_opened",
  "enrollment_requested",
  "machine_ready",
  "setup_result",
]);

const mobileDownloadPropertiesSchema = z
  .object({
    target: z.literal("mobile"),
    action: z.literal("download_clicked"),
    outcome: z.literal("observed"),
    source: deviceSetupSourceSchema,
    error_category: z.null(),
    platform: z.enum(["ios", "android"]),
  })
  .strict();

export const deviceSetupPropertiesSchema = z
  .discriminatedUnion("target", [
    z
      .object({
        target: z.literal("browser_access"),
        action: browser,
        ...setupFields,
      })
      .strict(),
    z
      .object({
        target: z.literal("additional_machine"),
        action: machine,
        ...setupFields,
      })
      .strict(),
    mobileDownloadPropertiesSchema,
  ])
  .superRefine((value, context) => {
    if (value.target === "mobile") return;
    if (value.action === "setup_result") {
      if (!failure.safeParse(value).success)
        context.addIssue({ code: "custom", message: "Invalid setup result" });
      return;
    }
    const expected =
      value.action === "setup_opened" || value.action === "remote_connected"
        ? "observed"
        : value.action === "enable_requested" ||
            value.action === "enrollment_requested"
          ? "started"
          : "succeeded";
    if (value.outcome !== expected || value.error_category !== null) {
      context.addIssue({
        code: "custom",
        message: "Invalid device milestone outcome",
      });
    }
  });
export type DeviceSetupProperties = z.infer<typeof deviceSetupPropertiesSchema>;
export const connectDeviceSetupPropertiesSchema = z
  .object({
    target: z.literal("browser_access"),
    action: z.enum(["enable_requested", "service_ready", "setup_result"]),
    outcome: z.enum(["started", "succeeded", "failed", "cancelled", "unknown"]),
    source: deviceSetupSourceSchema,
    error_category: errorCategorySchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!deviceSetupPropertiesSchema.safeParse(value).success)
      context.addIssue({
        code: "custom",
        message: "Invalid Connect setup milestone",
      });
  });
export type ConnectDeviceSetupProperties = z.infer<
  typeof connectDeviceSetupPropertiesSchema
>;

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

export function deviceSetupEvent(
  input: DeviceSetupProperties,
): DeviceSetupEvent {
  const context = {
    ...deviceTelemetryContext(input.source),
    step: "devices" as const,
    resource_type: "device" as const,
    resource_id: input.target,
  };
  if (input.target === "mobile")
    return serverDeviceSetupTelemetrySchema.parse({
      name: "onboarding_step_state",
      properties: {
        ...context,
        state: "download_requested",
        platform: input.platform,
      },
    });
  if (input.action === "setup_opened" || input.action === "remote_connected")
    return serverDeviceSetupTelemetrySchema.parse({
      name: "onboarding_step_state",
      properties: {
        ...context,
        state: input.action === "setup_opened" ? "setup_open" : "connected",
      },
    });
  return serverDeviceSetupTelemetrySchema.parse({
    name: "onboarding_operation",
    properties: {
      ...context,
      operation: input.target === "browser_access" ? "enable" : "enroll",
      outcome: input.outcome,
      error_category: input.error_category,
    },
  });
}
