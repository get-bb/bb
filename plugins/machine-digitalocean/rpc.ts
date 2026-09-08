import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { configSchema } from "./devbox.js";
export const hostInput = z.object({ hostId: z.string().min(1) }).strict();
export const devboxRpc = defineRpcContract({
  configuration: { input: hostInput, output: configSchema },
  machines: {
    input: z.null(),
    output: z.array(z.object({ id: z.string(), name: z.string() })),
  },
  status: {
    input: hostInput,
    output: z.object({ summary: z.string(), values: z.json() }),
  },
  configure: {
    input: hostInput.extend({ config: configSchema }),
    output: configSchema,
  },
  sleep: {
    input: hostInput,
    output: z.object({
      ok: z.literal(true),
      power: z.enum(["active", "off"]),
      backupError: z.string().nullable(),
      details: z.object({ summary: z.string(), values: z.json() }),
      backupStatus: z.enum(["none", "complete", "off, backup failed"]),
      snapshotId: z.string().nullable(),
    }),
  },
  wake: { input: hostInput, output: z.object({ ok: z.literal(true) }) },
});
