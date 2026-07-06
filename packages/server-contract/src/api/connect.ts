import { z } from "zod";

/**
 * `POST /connect/pair` — redeem a one-time connect code so this server is
 * reachable at `<handle>.<domain>` through the connect tunnel. The server
 * holds the tunnel from then on (across restarts); the CLI/app just pair.
 * `baseUrl` (the connect cloud apex, e.g. https://getbb.app) is derived from
 * `serverUrl` when omitted.
 */
export const connectPairRequestSchema = z
  .object({
    code: z.string().min(1),
    serverUrl: z.string().url(),
    baseUrl: z.string().url().optional(),
  })
  .strict();
export type ConnectPairRequest = z.infer<typeof connectPairRequestSchema>;

/** Current connect state. `connected` is the live tunnel socket status. */
export const connectStatusResponseSchema = z.object({
  paired: z.boolean(),
  handle: z.string().nullable(),
  url: z.string().nullable(),
  connected: z.boolean(),
  lastError: z.string().nullable(),
});
export type ConnectStatusResponse = z.infer<typeof connectStatusResponseSchema>;
