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
export const serverDeviceSetupTelemetrySchema = z
  .object({
    name: z.literal("device_setup"),
    properties: deviceSetupPropertiesSchema,
  })
  .strict();

export type DeviceSetupEvent = z.infer<typeof serverDeviceSetupTelemetrySchema>;

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

export const deviceSetupTelemetrySchema = z
  .object({
    name: z.literal("device_setup"),
    properties: z.discriminatedUnion("target", [
      z
        .object({
          target: z.enum(["browser_access", "additional_machine"]),
          action: z.literal("setup_opened"),
          outcome: z.literal("observed"),
          source: deviceSetupSourceSchema,
          error_category: z.null(),
        })
        .strict(),
      mobileDownloadPropertiesSchema,
    ]),
  })
  .strict();
