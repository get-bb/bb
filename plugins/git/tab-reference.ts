import { filePathSchema } from "./contract.js";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { z } from "zod";
export const gitDiffTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: filePathSchema }).strict(),
  z
    .object({
      kind: z.literal("commit"),
      sha: z.string().regex(/^[0-9a-f]{4,40}$/iu),
    })
    .strict(),
]);
type GitDiffTarget = z.infer<typeof gitDiffTargetSchema>;
export const gitDiffTab = {
  id: "diff",
  experimental_target: {
    validate(value: JsonValue): value is GitDiffTarget {
      return gitDiffTargetSchema.safeParse(value).success;
    },
  },
};
