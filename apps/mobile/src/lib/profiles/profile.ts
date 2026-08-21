import { z } from "zod";

/**
 * A saved bb server the phone can talk to. Persisted one-per-key in secure
 * storage (`bb.profile.<id>`), so the whole record must stay well under 2 KB.
 *
 * - `direct`: the user typed a URL (LAN, Tailscale Serve, simulator loopback).
 *   No auth; same trust model as the PWA.
 * - `connect`: `https://<handle>.getbb.app`; the phone is enrolled as a connect
 *   machine and holds the durable `bbcm_` credential used only to mint the
 *   short-lived desktop-session cookie.
 */
export const PROFILE_LABEL_MAX_LENGTH = 64;

const profileBaseSchema = z.object({
  id: z.string().min(1),
  serverUrl: z.string().url(),
  label: z.string().min(1).max(PROFILE_LABEL_MAX_LENGTH),
  createdAt: z.number().int().nonnegative(),
});

const directServerProfileSchema = profileBaseSchema
  .extend({ mode: z.literal("direct") })
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

export type DirectServerProfile = z.infer<typeof directServerProfileSchema>;
export type ConnectServerProfile = z.infer<typeof connectServerProfileSchema>;
export type ServerProfile = z.infer<typeof serverProfileSchema>;
export type ServerProfileMode = ServerProfile["mode"];

/** Everything the caller supplies when adding a profile; id/createdAt are assigned. */
export type NewServerProfile =
  | Omit<DirectServerProfile, "id" | "createdAt">
  | Omit<ConnectServerProfile, "id" | "createdAt">;

/** Fields a caller may change after creation. Mode/id are immutable. */
export type ServerProfilePatch = Partial<
  Pick<ConnectServerProfile, "label" | "serverUrl" | "handle" | "credential">
>;
