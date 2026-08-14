import { defineRpcContract } from "@bb/plugin-sdk";
import { z } from "zod";

import { rpcContract } from "../../shared/contract.js";

const cachedProjectVersionsRpc = {
  input: z.object({ projectId: z.string().min(1).max(512) }).strict(),
  output: z
    .object({
      versions: z.array(
        z
          .object({
            platformProjectId: z.string().min(1).max(512),
            projectVersionId: z.string().min(1).max(512),
            asOf: z.string().nullable(),
            state: z.enum(["fresh", "stale"]),
          })
          .strict(),
      ),
      selectedPlatformProjectId: z.string().min(1).max(512).nullable(),
      selectedProjectVersionId: z.string().min(1).max(512).nullable(),
    })
    .strict(),
} as const;

// This copies WP-24's discovery shape under BOM ownership. No findings-lane
// source or handler is imported across the lane boundary.
export const bomCachedVersionsContract = defineRpcContract({
  bomCachedProjectVersions: cachedProjectVersionsRpc,
});

export const bomAppRpcContract = defineRpcContract({
  bomSoftwareList: rpcContract.bomSoftwareList,
  bomComponentGet: rpcContract.bomComponentGet,
  syncPull: rpcContract.syncPull,
  bomCachedProjectVersions: cachedProjectVersionsRpc,
});
