import { defineRpcContract } from "@bb/plugin-sdk";
import { z } from "zod";
import { rpcContract } from "../../shared/contract.js";

const identifier = z.string().min(1).max(512);

export const benchUiRpcContract = defineRpcContract({
  benchProjectVersions: {
    input: z.object({ projectId: identifier }).strict(),
    output: z
      .object({
        versions: z.array(
          z
            .object({
              platformProjectId: identifier,
              projectVersionId: identifier,
              asOf: z.string().nullable(),
              state: z.enum(["fresh", "stale"]),
            })
            .strict(),
        ),
        selectedPlatformProjectId: identifier.nullable(),
        selectedProjectVersionId: identifier.nullable(),
      })
      .strict(),
  },
  benchRunAttemptStart: {
    input: rpcContract.benchRunStart.input,
    output: z.discriminatedUnion("success", [
      z
        .object({
          success: z.literal(true),
          run: rpcContract.benchRunStart.output,
        })
        .strict(),
      z
        .object({
          success: z.literal(false),
          runId: identifier,
          code: identifier,
          message: z.string().min(1).max(20_000),
        })
        .strict(),
    ]),
  },
});
