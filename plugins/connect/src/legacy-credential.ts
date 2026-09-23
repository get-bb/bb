import { connectCredentialSchema } from "@bb/connect-client";
import type { ConnectCredential } from "@bb/connect-client";
import type { PluginKvStorage } from "@get-bb/plugin-sdk";

export const LEGACY_CREDENTIAL_KV_KEY = "credential";

export interface LegacyCredentialStore {
  read(): Promise<ConnectCredential | null>;
  clear(): Promise<void>;
}

export function createLegacyCredentialStore(
  kv: Pick<PluginKvStorage, "get" | "delete">,
): LegacyCredentialStore {
  return {
    async read() {
      const raw = await kv.get<unknown>(LEGACY_CREDENTIAL_KV_KEY);
      if (raw === undefined) return null;
      const parsed = connectCredentialSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },
    async clear() {
      await kv.delete(LEGACY_CREDENTIAL_KV_KEY);
    },
  };
}
