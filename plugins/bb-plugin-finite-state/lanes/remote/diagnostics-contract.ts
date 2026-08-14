import { defineRpcContract } from "@bb/plugin-sdk";
import { z } from "zod";
import { REMOTE_FAILURE_KINDS } from "../../lib/remote/errors.js";

export const remoteFailureKindSchema = z.enum(REMOTE_FAILURE_KINDS);

export const remoteFailureDiagnosticSchema = z
  .object({
    kind: remoteFailureKindSchema,
    message: z.string().min(1).max(4_000),
    retryable: z.boolean(),
    service: z
      .enum(["platform", "assurance-studio", "forge-compute"])
      .nullable(),
    status: z.number().int().min(100).max(599).nullable(),
    request: z
      .object({
        method: z.string().min(1).max(32),
        url: z.string().min(1).max(4_096),
        phase: z.string().min(1).max(128),
      })
      .strict()
      .nullable(),
    credential: z
      .object({
        header: z.string().min(1).max(128),
        label: z.string().min(1).max(128),
        setting: z.string().min(1).max(128),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type RemoteFailureDiagnosticView = z.infer<
  typeof remoteFailureDiagnosticSchema
>;

export const remoteDiagnosticsRpcContract = defineRpcContract({
  remoteConnectionDiagnostics: {
    input: z.null(),
    output: z
      .object({
        platform: remoteFailureDiagnosticSchema.nullable(),
        assuranceStudio: remoteFailureDiagnosticSchema.nullable(),
        forgeCompute: remoteFailureDiagnosticSchema.nullable(),
      })
      .strict(),
  },
} as const);
