import { createHash } from "node:crypto";
import { z } from "zod";
import {
  connectCredentialSchema,
  deriveConnectBaseUrl,
  type ConnectCredential,
} from "@bb/connect-client";
import type { PluginKvStorage, PluginLogger } from "@get-bb/plugin-sdk";
import type {
  AccountClient,
  AccountStatus,
  SharedCredential,
} from "./account-client.js";

export const CREDENTIAL_COPY_KV_KEY = "credential";
export const COPY_MARKER_KV_KEY = "credentialCopyOf";

const copyMarkerSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export interface CredentialCopyStore {
  read(): Promise<ConnectCredential | null>;
  readMarker(): Promise<string | null>;
  write(value: ConnectCredential): Promise<void>;
  writeMarker(marker: string): Promise<void>;
  clear(): Promise<void>;
}

export function credentialMarker(credential: string): string {
  return createHash("sha256").update(credential).digest("hex");
}

export function createCredentialCopyStore(
  kv: Pick<PluginKvStorage, "get" | "set" | "delete">,
): CredentialCopyStore {
  return {
    async read() {
      const raw = await kv.get<unknown>(CREDENTIAL_COPY_KV_KEY);
      if (raw === undefined) return null;
      const parsed = connectCredentialSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },
    async readMarker() {
      const parsed = copyMarkerSchema.safeParse(
        await kv.get<unknown>(COPY_MARKER_KV_KEY),
      );
      return parsed.success ? parsed.data : null;
    },
    async write(value) {
      await kv.set(CREDENTIAL_COPY_KV_KEY, value);
      await kv.set(COPY_MARKER_KV_KEY, credentialMarker(value.credential));
    },
    async writeMarker(marker) {
      await kv.set(COPY_MARKER_KV_KEY, marker);
    },
    async clear() {
      await kv.delete(CREDENTIAL_COPY_KV_KEY);
      await kv.delete(COPY_MARKER_KV_KEY);
    },
  };
}

function copyOf(shared: SharedCredential): ConnectCredential {
  const serverUrl = shared.serverUrl.replace(/\/$/u, "");
  return {
    serverUrl,
    handle: new URL(serverUrl).hostname.split(".")[0] ?? serverUrl,
    credential: shared.credential,
  };
}

interface CredentialCopyOptions {
  account: AccountClient;
  store: CredentialCopyStore;
  log: PluginLogger;
}

export class CredentialCopy {
  private readonly rejected = new Set<string>();

  constructor(private readonly options: CredentialCopyOptions) {}

  async sync(status: AccountStatus): Promise<boolean> {
    const { account, store, log } = this.options;
    const copy = await store.read();
    const marker = await store.readMarker();
    const shared =
      status.state === "signed-out" ? null : await account.connectCredential();

    if (shared !== null) {
      if (copy?.credential === shared.credential) {
        const expected = credentialMarker(shared.credential);
        if (marker !== expected) await store.writeMarker(expected);
        return false;
      }
      if (
        copy !== null &&
        marker !== credentialMarker(copy.credential) &&
        !this.rejected.has(copy.credential)
      ) {
        const result = await this.adopt(copy, shared.credential);
        if (result !== "rejected") return true;
      }
      await store.write(copyOf(shared));
      log.info(
        "saved a copy of bb account's pairing where older bb builds look for it",
      );
      return false;
    }

    if (copy === null) return false;
    if (marker === credentialMarker(copy.credential)) {
      await store.clear();
      log.info(
        "bb account signed out, so connect removed its copy of that pairing",
      );
      return false;
    }
    if (this.rejected.has(copy.credential)) return false;
    return (await this.adopt(copy, null)) !== "rejected";
  }

  private async adopt(
    copy: ConnectCredential,
    replaces: string | null,
  ): Promise<"adopted" | "rejected" | "changed"> {
    const { result } = await this.options.account.adoptConnectCredential({
      credential: copy.credential,
      baseUrl: deriveConnectBaseUrl(copy.serverUrl),
      replaces,
    });
    if (result === "adopted") {
      await this.options.store.writeMarker(credentialMarker(copy.credential));
      this.options.log.info(
        replaces === null
          ? "copied connect's pairing into bb account; connect keeps its copy for older bb builds"
          : "bb account now uses the newer pairing connect holds",
      );
    } else if (result === "rejected") {
      this.rejected.add(copy.credential);
      this.options.log.info(
        "getbb.app rejected connect's stored pairing, so bb account kept its own state",
      );
    }
    return result;
  }
}
