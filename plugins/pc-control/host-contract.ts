import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  exePathSchema,
  cwdPathSchema,
  processListOutputSchema,
  processNameSchema,
  systemSnapshotSchema,
} from "./pc/schemas.js";

const matcherSchema = z
  .object({
    key: z.string().min(1).max(64),
    processName: processNameSchema,
    exePath: exePathSchema,
  })
  .strict();

export const pcControlHostContract = defineRpcContract({
  systemSnapshot: {
    input: z.null(),
    output: systemSnapshotSchema,
  },
  listProcesses: {
    input: z.null(),
    output: processListOutputSchema,
  },
  resolveProcessMatches: {
    input: z
      .object({
        matchers: z.array(matcherSchema).min(1).max(32),
      })
      .strict(),
    output: z
      .object({
        matches: z
          .array(
            z
              .object({
                key: z.string().min(1).max(64),
                pids: z.array(z.number().int().positive()).max(32),
              })
              .strict(),
          )
          .max(32),
      })
      .strict(),
  },
  startApp: {
    input: z
      .object({
        exePath: exePathSchema,
        args: z.array(z.string().min(1).max(1024)).max(32),
        cwd: cwdPathSchema,
      })
      .strict(),
    output: z.object({ pid: z.number().int().positive() }).strict(),
  },
  stopProcesses: {
    input: z
      .object({
        pids: z.array(z.number().int().positive()).min(1).max(32),
        processName: processNameSchema,
        exePath: exePathSchema,
      })
      .strict(),
    output: z
      .object({
        stoppedCount: z.number().int().nonnegative(),
      })
      .strict(),
  },
});
