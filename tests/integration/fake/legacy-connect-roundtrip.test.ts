import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createKvCredentialStore,
  CREDENTIAL_KV_KEY,
} from "../../../plugins/connect/src/credential.js";
import { importLegacyConnectCredential } from "../../../plugins/connect/src/migrate-legacy.js";
import { ConnectTunnel } from "../../../plugins/connect/src/tunnel.js";

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function createMemoryKv() {
  const rows = new Map<string, string>();
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const raw = rows.get(key);
      return raw === undefined ? undefined : (JSON.parse(raw) as T);
    },
    async set(key: string, value: unknown): Promise<void> {
      rows.set(key, JSON.stringify(value));
    },
    async delete(key: string): Promise<void> {
      rows.delete(key);
    },
  };
}

describe("legacy connect credential round trip", () => {
  it("imports <dataDir>/connect.json into plugin kv and re-establishes a paired tunnel", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-connect-roundtrip-"));
    try {
      // The kernel-era credential file, exactly as credential-store.ts wrote it.
      await writeFile(
        join(dataDir, "connect.json"),
        JSON.stringify(
          {
            serverUrl: "http://127.0.0.1:59331",
            handle: "sawyer",
            credential: "bbcred_legacy",
          },
          null,
          2,
        ),
      );

      const kv = createMemoryKv();
      const store = createKvCredentialStore(kv);
      const imported = await importLegacyConnectCredential({
        kv,
        store,
        dataDir,
        log: silentLog,
      });
      expect(imported).toBe(true);

      // Credential round-trips through kv…
      expect(await kv.get(CREDENTIAL_KV_KEY)).toEqual({
        serverUrl: "http://127.0.0.1:59331",
        handle: "sawyer",
        credential: "bbcred_legacy",
      });
      // …the file is moved aside so it is never re-imported…
      await expect(access(join(dataDir, "connect.json"))).rejects.toThrow();
      expect(
        JSON.parse(
          await readFile(join(dataDir, "connect.json.migrated"), "utf8"),
        ),
      ).toMatchObject({ handle: "sawyer" });

      // …and the tunnel comes back paired with zero user action (loopback
      // serverUrl: the dial refuses instantly; paired + reconnecting, never
      // "not paired").
      const tunnel = new ConnectTunnel({
        store,
        getLoopbackBaseUrl: () => "http://127.0.0.1:38886",
        log: silentLog,
      });
      try {
        await tunnel.start();
        const status = tunnel.status();
        expect(status.paired).toBe(true);
        expect(status.handle).toBe("sawyer");
        expect(status.url).toBe("http://127.0.0.1:59331");
        expect(status.state).toBe("reconnecting");
      } finally {
        tunnel.stop();
      }

      // A second load is a no-op (done marker), even with a new file present.
      await writeFile(join(dataDir, "connect.json"), "{}");
      expect(
        await importLegacyConnectCredential({ kv, store, dataDir, log: silentLog }),
      ).toBe(false);
      await expect(access(join(dataDir, "connect.json"))).resolves.toBeUndefined();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("tolerates a corrupt connect.json (moved aside, nothing imported)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-connect-roundtrip-"));
    try {
      await writeFile(join(dataDir, "connect.json"), "not json {{{");
      const kv = createMemoryKv();
      const store = createKvCredentialStore(kv);
      const imported = await importLegacyConnectCredential({
        kv,
        store,
        dataDir,
        log: silentLog,
      });
      expect(imported).toBe(false);
      expect(await store.read()).toBeNull();
      await expect(access(join(dataDir, "connect.json"))).rejects.toThrow();
      await expect(
        access(join(dataDir, "connect.json.migrated")),
      ).resolves.toBeUndefined();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("tolerates a missing connect.json (fresh install)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-connect-roundtrip-"));
    try {
      const kv = createMemoryKv();
      const store = createKvCredentialStore(kv);
      const imported = await importLegacyConnectCredential({
        kv,
        store,
        dataDir,
        log: silentLog,
      });
      expect(imported).toBe(false);
      expect(await store.read()).toBeNull();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
