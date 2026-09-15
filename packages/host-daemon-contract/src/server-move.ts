import { lastServerMoveSchema, serverMoveStepIdSchema } from "@bb/domain";
import { z } from "zod";
import { hostPlatformSchema } from "./local.js";

const moveIdSchema = z.string().min(1);
const activationTokenSchema = z.string().min(16);
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const portSchema = z.number().int().min(1).max(65535);

export const serverMoveServiceManagerSchema = z.enum([
  "launchd",
  "systemd-user",
  "systemd-system",
  "none",
]);
export type ServerMoveServiceManager = z.infer<
  typeof serverMoveServiceManagerSchema
>;

export const serverMoveBindHostSchema = z.enum(["127.0.0.1", "0.0.0.0"]);

export const serverMoveHealthStateSchema = z.enum([
  "pending",
  "activating",
  "ready",
]);
export type ServerMoveHealthState = z.infer<typeof serverMoveHealthStateSchema>;

export const serverMoveHealthSchema = z.object({
  moveId: moveIdSchema,
  state: serverMoveHealthStateSchema,
});
export type ServerMoveHealth = z.infer<typeof serverMoveHealthSchema>;

export const serverHealthResponseSchema = z.object({
  serverMove: serverMoveHealthSchema.optional(),
});
export type ServerHealthResponse = z.infer<typeof serverHealthResponseSchema>;

export const serverMoveCommandSchemas = {
  "server_move.inspect": z
    .object({
      type: z.literal("server_move.inspect"),
      paths: z.array(z.string().min(1)).max(200),
      port: portSchema,
    })
    .strict(),
  "server_move.probe": z
    .object({
      type: z.literal("server_move.probe"),
      url: z.string().min(1),
      moveId: moveIdSchema,
    })
    .strict(),
  "server_move.prepare": z
    .object({
      type: z.literal("server_move.prepare"),
      moveId: moveIdSchema,
      activationToken: activationTokenSchema,
      archive: z
        .object({
          downloadPath: z.string().min(1),
          sha256: sha256HexSchema,
          sizeBytes: z.number().int().nonnegative(),
        })
        .strict(),
      bbApp: z
        .object({
          downloadPath: z.string().min(1),
          sha256: sha256HexSchema,
          sizeBytes: z.number().int().nonnegative(),
          version: z.string().min(1),
        })
        .strict()
        .nullable(),
      serverPort: portSchema,
      bindHost: serverMoveBindHostSchema.nullable(),
      sourceDataDir: z.string().min(1),
      sourceServerHostId: z.string().min(1).nullable(),
      serverUrl: z.string().min(1),
      archiveExistingServerData: z.boolean(),
    })
    .strict(),
  "server_move.activate": z
    .object({
      type: z.literal("server_move.activate"),
      moveId: moveIdSchema,
      activationToken: activationTokenSchema,
      lastMove: lastServerMoveSchema,
    })
    .strict(),
  "server_move.abort": z
    .object({
      type: z.literal("server_move.abort"),
      moveId: moveIdSchema,
    })
    .strict(),
  "server_move.delete_old_copy": z
    .object({
      type: z.literal("server_move.delete_old_copy"),
    })
    .strict(),
} as const;

const existingServerDataSchema = z
  .object({
    path: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export const serverMoveResultSchemas = {
  "server_move.inspect": z
    .object({
      dataDir: z.string().min(1),
      platform: hostPlatformSchema,
      timeZone: z.string().min(1).nullable(),
      bbAppVersion: z.string().min(1),
      serverEntryAvailable: z.boolean(),
      serviceManager: serverMoveServiceManagerSchema,
      existingServerData: existingServerDataSchema.nullable(),
      dataDirHasServerData: z.boolean(),
      portAvailable: z.boolean(),
      ghAuthenticated: z.boolean().nullable(),
      codexCredentialsPresent: z.boolean(),
      pathsExist: z.record(z.string(), z.boolean()),
      diskFreeBytes: z.number().int().nonnegative().nullable(),
    })
    .strict(),
  "server_move.probe": z
    .object({
      reachable: z.boolean(),
      message: z.string().nullable(),
      state: serverMoveHealthStateSchema.nullable(),
    })
    .strict(),
  "server_move.prepare": z
    .object({
      localServerUrl: z.string().min(1),
      pid: z.number().int().positive(),
    })
    .strict(),
  "server_move.activate": z.object({ ok: z.literal(true) }).strict(),
  "server_move.abort": z.object({ ok: z.literal(true) }).strict(),
  "server_move.delete_old_copy": z.object({ deleted: z.boolean() }).strict(),
} as const;

export type ServerMoveInspectResult = z.infer<
  (typeof serverMoveResultSchemas)["server_move.inspect"]
>;

export const serverMovedMessageSchema = z
  .object({
    type: z.literal("server.moved"),
    serverUrl: z.string().min(1),
    headers: z.record(z.string(), z.string()),
  })
  .strict();
export type ServerMovedMessage = z.infer<typeof serverMovedMessageSchema>;

export const serverMoveProgressMessageSchema = z
  .object({
    type: z.literal("server_move.progress"),
    moveId: moveIdSchema,
    step: serverMoveStepIdSchema,
    message: z.string(),
  })
  .strict();
export type ServerMoveProgressMessage = z.infer<
  typeof serverMoveProgressMessageSchema
>;

export const SERVER_MOVED_ERROR_CODE = "server_moved";

export const serverMovedErrorDetailsSchema = z
  .object({
    serverUrl: z.string().min(1),
    toHostName: z.string().min(1),
    movedAt: z.number().int().nonnegative(),
  })
  .strict();
export type ServerMovedErrorDetails = z.infer<
  typeof serverMovedErrorDetailsSchema
>;
