import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const piModelSettingsModelSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string(),
    provider: z.string().min(1),
    reasoning: z.boolean(),
  })
  .strict();

export const piModelSettingsSnapshotSchema = z
  .object({
    models: z.array(piModelSettingsModelSchema),
    enabledModelIds: z.array(z.string().min(1)).nullable(),
  })
  .strict();

export const piModelSettingsBridgeContract = defineRpcContract({
  "model-settings/read": {
    input: z.null(),
    output: piModelSettingsSnapshotSchema,
  },
  "model-settings/write": {
    input: z
      .object({ enabledModelIds: z.array(z.string().min(1)).nullable() })
      .strict(),
    output: piModelSettingsSnapshotSchema,
  },
});

export const piModelSettingsRpcContract = defineRpcContract({
  readModelSettings: {
    input: z.object({ hostId: z.string().min(1) }).strict(),
    output: piModelSettingsSnapshotSchema,
  },
  writeModelSettings: {
    input: z
      .object({
        hostId: z.string().min(1),
        enabledModelIds: z.array(z.string().min(1)).nullable(),
      })
      .strict(),
    output: piModelSettingsSnapshotSchema,
  },
});

export type PiModelSettingsModel = z.infer<typeof piModelSettingsModelSchema>;
export type PiModelSettingsSnapshot = z.infer<
  typeof piModelSettingsSnapshotSchema
>;
