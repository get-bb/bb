import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const serverPortSchema = z
  .object({ port: z.number().int(), address: z.string() })
  .strict();

export const devServerSchema = z
  .object({
    threadId: z.string(),
    rootPid: z.number().int(),
    startedAt: z.number().nullable(),
    command: z.string().nullable(),
    cwd: z.string().nullable(),
    ports: z.array(serverPortSchema).min(1),
  })
  .strict();
export type DevServer = z.infer<typeof devServerSchema>;

export const devServersHostContract = defineRpcContract({
  list: {
    experimental_retryable: true,
    input: z.object({ threadId: z.string().min(1).nullable() }).strict(),
    output: z
      .object({ supported: z.boolean(), servers: z.array(devServerSchema) })
      .strict(),
  },
  stop: {
    input: z
      .object({
        threadId: z.string().min(1),
        rootPid: z.number().int().positive(),
        startedAt: z.number().nullable(),
      })
      .strict(),
    output: z.object({ stopped: z.boolean() }).strict(),
  },
});

export function serversTag(threadId: string): string {
  return `servers:${threadId}`;
}

const hostServerSchema = devServerSchema.extend({
  hostId: z.string(),
  hostName: z.string(),
  primaryHost: z.boolean(),
});
export type HostDevServer = z.infer<typeof hostServerSchema>;

export const devServersContract = defineRpcContract({
  "servers.list": {
    tags: ({ threadId }) => [serversTag(threadId)],
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z
      .object({
        status: z.enum(["ok", "no-environment", "offline", "unsupported"]),
        servers: z.array(hostServerSchema),
      })
      .strict(),
  },
  "servers.stop": {
    input: z
      .object({
        threadId: z.string().min(1),
        rootPid: z.number().int().positive(),
        startedAt: z.number().nullable(),
      })
      .strict(),
    output: z.object({ stopped: z.boolean() }).strict(),
  },
});
