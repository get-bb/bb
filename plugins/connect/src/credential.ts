import { z } from "zod";
import type { PluginKvStorage } from "@bb/plugin-sdk";

// The durable tunnel credential lives in the plugin's kv storage (bb.db),
// replacing the kernel-era <dataDir>/connect.json file (imported once by
// migrate-legacy.ts). Same shape as the legacy file, so the schema parses
// both.
export const connectCredentialSchema = z.object({
  serverUrl: z.string().min(1),
  handle: z.string().min(1),
  credential: z.string().min(1),
});

export type ConnectCredential = z.infer<typeof connectCredentialSchema>;

export const CREDENTIAL_KV_KEY = "credential";

export interface CredentialStore {
  read(): Promise<ConnectCredential | null>;
  write(value: ConnectCredential): Promise<void>;
  clear(): Promise<void>;
}

export function createKvCredentialStore(
  kv: Pick<PluginKvStorage, "get" | "set" | "delete">,
): CredentialStore {
  return {
    async read() {
      const raw = await kv.get<unknown>(CREDENTIAL_KV_KEY);
      if (raw === undefined) return null;
      const parsed = connectCredentialSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },
    async write(value) {
      await kv.set(CREDENTIAL_KV_KEY, value);
    },
    async clear() {
      await kv.delete(CREDENTIAL_KV_KEY);
    },
  };
}
