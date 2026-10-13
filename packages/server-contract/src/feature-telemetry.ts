import { z } from "zod";

export const coreFeatureSchema = z.enum([
  "thread",
  "child_thread",
  "provider",
  "remote_access",
  "automation",
  "browser",
  "terminal",
  "file",
  "git",
  "settings",
  "project",
  "environment",
  "split_view",
  "search",
  "voice",
  "plugin_management",
]);
export type CoreFeature = z.infer<typeof coreFeatureSchema>;

export const telemetryTriggerSchema = z.enum([
  "person",
  "agent",
  "schedule",
  "system",
  "unknown",
]);
export type TelemetryTrigger = z.infer<typeof telemetryTriggerSchema>;

export const pluginSourceSchema = z.enum([
  "builtin",
  "public_catalog",
  "private_marketplace",
  "local",
  "unknown",
]);
export type TelemetryPluginSource = z.infer<typeof pluginSourceSchema>;

const featureInteractionSchema = z.enum(["opened", "invoked", "ran"]);

export const coreFeatureUsedPropertiesSchema = z
  .object({
    feature: coreFeatureSchema,
    feature_scope: z.literal("core"),
    interaction: featureInteractionSchema,
    trigger: telemetryTriggerSchema,
  })
  .strict();

export const featureUsedPropertiesSchema = z.discriminatedUnion(
  "feature_scope",
  [
    coreFeatureUsedPropertiesSchema,
    z
      .object({
        feature: z.union([coreFeatureSchema, z.literal("plugin")]),
        feature_scope: z.literal("plugin"),
        interaction: featureInteractionSchema,
        trigger: telemetryTriggerSchema,
        plugin_source: pluginSourceSchema,
      })
      .strict(),
  ],
);
export type FeatureUsedProperties = z.infer<typeof featureUsedPropertiesSchema>;
