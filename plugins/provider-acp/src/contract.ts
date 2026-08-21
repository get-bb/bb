/**
 * The plugin's host RPC contract.
 *
 * A provider declaration states its capabilities before any agent has spoken.
 * The agent itself reports the truth at `initialize`, but only on the machine
 * where it is installed — so the plugin asks its own host worker (Q21).
 */

import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const acpProbeResultSchema = z.union([
  z
    .object({
      reachable: z.literal(true),
      protocolVersion: z.number(),
      fork: z.boolean(),
      loadSession: z.boolean(),
      promptImage: z.boolean(),
      authMethods: z.array(z.string()),
    })
    .strict(),
  z.object({ reachable: z.literal(false), reason: z.string() }).strict(),
]);
export type AcpProbeResult = z.infer<typeof acpProbeResultSchema>;

export const acpHostContract = defineRpcContract({
  /** Ask one installed agent what it supports. Never throws. */
  probeAgent: {
    input: z
      .object({
        command: z.string().min(1),
        args: z.array(z.string()).default([]),
        env: z.record(z.string(), z.string()).default({}),
      })
      .strict(),
    output: acpProbeResultSchema,
  },
});
