import { z } from "zod";
import { defineRpcContract } from "./rpc-contract.js";

const absolutePath = z
  .string()
  .min(1)
  .refine(
    (value) => value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value),
    "Expected an absolute host path",
  );
/** First-party provider host paths for global skill installation and credential presence checks. */
export const internal_DO_NOT_USE_providerPathsHostContract = defineRpcContract({
  resolveProviderPaths: {
    input: z.object({}).strict(),
    output: z
      .object({
        skillInstallRoots: z.array(absolutePath).max(32),
        credentialFiles: z.array(absolutePath).max(32),
      })
      .strict(),
  },
});
