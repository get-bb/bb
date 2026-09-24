import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { profileResponseSchema, type AccountProfile } from "./hosted.js";

export const CREDENTIAL_KV_KEY = "credential";
export const PROFILE_KV_KEY = "profile";
export const REVISION_KV_KEY = "revision";

export const storedCredentialSchema = z.object({
  baseUrl: z.string().url(),
  serverUrl: z.string().url(),
  serverId: z.string().min(1),
  credential: z.string().min(1),
});

export type StoredCredential = z.infer<typeof storedCredentialSchema>;

export interface AccountStore {
  readCredential(): Promise<StoredCredential | null>;
  readProfile(): Promise<AccountProfile | null>;
  readRevision(): Promise<number>;
  writeAccount(
    credential: StoredCredential,
    profile: AccountProfile | null,
  ): Promise<void>;
  writeRevision(revision: number): Promise<void>;
  clear(): Promise<void>;
}

export function createKvAccountStore(
  kv: Pick<PluginKvStorage, "get" | "set" | "delete">,
): AccountStore {
  return {
    async readCredential() {
      const parsed = storedCredentialSchema.safeParse(
        await kv.get<unknown>(CREDENTIAL_KV_KEY),
      );
      return parsed.success ? parsed.data : null;
    },
    async readProfile() {
      const parsed = profileResponseSchema.safeParse(
        await kv.get<unknown>(PROFILE_KV_KEY),
      );
      return parsed.success ? parsed.data : null;
    },
    async readRevision() {
      const parsed = z
        .number()
        .int()
        .nonnegative()
        .safeParse(await kv.get<unknown>(REVISION_KV_KEY));
      return parsed.success ? parsed.data : 0;
    },
    async writeAccount(credential, profile) {
      await kv.set(CREDENTIAL_KV_KEY, credential);
      if (profile === null) {
        await kv.delete(PROFILE_KV_KEY);
      } else {
        await kv.set(PROFILE_KV_KEY, profile);
      }
    },
    async writeRevision(revision) {
      await kv.set(REVISION_KV_KEY, revision);
    },
    async clear() {
      await kv.delete(CREDENTIAL_KV_KEY);
      await kv.delete(PROFILE_KV_KEY);
    },
  };
}
