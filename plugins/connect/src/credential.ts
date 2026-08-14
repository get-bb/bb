import { connectCredentialSchema } from "@bb/connect-client";
import type { ConnectCredential } from "@bb/connect-client";
import type { PluginKvStorage } from "@get-bb/plugin-sdk";

// The durable tunnel credential lives in the plugin's kv storage (bb.db). Its
// shape and the gate calls that use it live in @bb/connect-client, because the
// desktop app reaches the same gate without a local server.

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
