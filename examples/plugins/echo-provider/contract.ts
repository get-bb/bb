import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/**
 * A trivial host method, here to prove one plugin artifact can carry BOTH
 * surfaces: the provider bridge the daemon runs as its own process, and the
 * host RPC entry the server calls into. They share the artifact and nothing
 * else — separate bootstraps, separate process lifecycles.
 */
export const echoProviderHostContract = defineRpcContract({
  hostGreeting: {
    input: z.object({}).strict(),
    output: z.object({ platform: z.string(), dataDir: z.string() }).strict(),
  },
});
