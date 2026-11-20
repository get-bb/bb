import { z } from "zod";

export const PROFILE_LABEL_MAX_LENGTH = 64;

const profileBaseSchema = z.object({
  id: z.string().min(1),
  serverUrl: z.string().url(),
  label: z.string().min(1).max(PROFILE_LABEL_MAX_LENGTH),
  createdAt: z.number().int().nonnegative(),
});

export const directServerAccessSchema = z
  .object({ credentialId: z.string().min(1) })
  .strict();

const directServerProfileSchema = profileBaseSchema
  .extend({
    mode: z.literal("direct"),
    access: directServerAccessSchema.nullable(),
  })
  .strict();

const connectServerProfileSchema = profileBaseSchema
  .extend({
    mode: z.literal("connect"),
    handle: z.string().min(1),
    credential: z.string().min(1),
  })
  .strict();

export const serverProfileSchema = z.discriminatedUnion("mode", [
  directServerProfileSchema,
  connectServerProfileSchema,
]);

export type DirectServerAccess = z.infer<typeof directServerAccessSchema>;
export type DirectServerProfile = z.infer<typeof directServerProfileSchema>;
export type ConnectServerProfile = z.infer<typeof connectServerProfileSchema>;
export type ServerProfile = z.infer<typeof serverProfileSchema>;
export type NewServerProfile =
  | Omit<DirectServerProfile, "id" | "createdAt">
  | Omit<ConnectServerProfile, "id" | "createdAt">;

export type ServerProfilePatch = Partial<
  Pick<ConnectServerProfile, "label" | "serverUrl" | "handle" | "credential"> &
    Pick<DirectServerProfile, "access">
>;
