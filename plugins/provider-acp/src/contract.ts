/**
 * The plugin's host RPC contract.
 *
 * A provider declaration states its capabilities before any agent has spoken.
 * The agent itself reports the truth at `initialize`, but only on the machine
 * where it is installed — so the plugin asks its own host worker (Q21). The
 * same worker answers core's `resolveNativeRoots` (the SDK's native-roots
 * contract, spread in): the skill roots only the workspace host can name.
 */

import { defineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_nativeRootsHostContract } from "@get-bb/plugin-sdk/host";
import {
  experimental_acpAgentProbeSchema,
  type AcpAgentProbe,
} from "@get-bb/plugin-sdk/provider-bridge/acp";
import { z } from "zod";

/**
 * The probe answer, validated with the KIT's schema rather than a copy. A
 * hand-written copy that missed a field the kit later added would be rejected
 * by the server's output validation, and the plugin would log a debug line
 * and quietly stop narrowing anything.
 */
export type AcpProbeResult = AcpAgentProbe;

export const acpHostContract = defineRpcContract({
  /** Ask one installed agent what it supports. Never throws. */
  probeAgent: {
    // Required, not defaulted: the launch spec always has both, and a default
    // here would only let a caller omit what the agent needs.
    input: z
      .object({
        command: z.string().min(1),
        args: z.array(z.string()),
        env: z.record(z.string(), z.string()),
      })
      .strict(),
    output: experimental_acpAgentProbeSchema,
  },
  ...experimental_nativeRootsHostContract,
});
