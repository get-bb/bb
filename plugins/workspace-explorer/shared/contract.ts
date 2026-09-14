import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const explorerRpcContract = defineRpcContract({
  explorerRoot: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("ready"),
          environmentId: z.string(),
          environmentName: z.string().nullable(),
          hostId: z.string(),
          rootPath: z.string(),
        })
        .strict(),
      z.object({ status: z.literal("no-environment") }).strict(),
      z.object({ status: z.literal("no-workspace-path") }).strict(),
    ]),
  },
  explorerList: {
    input: z
      .object({ threadId: z.string().min(1), path: z.string() })
      .strict(),
    output: z
      .object({
        path: z.string(),
        environmentId: z.string(),
        rootPath: z.string(),
        entries: z
          .array(
            z
              .object({
                kind: z.enum(["directory", "file"]),
                name: z.string(),
                relativePath: z.string(),
              })
              .strict(),
          ),
      })
      .strict(),
  },
});
