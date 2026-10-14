import { z } from "zod";
import { withLocalStorage } from "@/lib/browser-storage";

export interface SealedTrustRecord {
  serverKey: string;
  fingerprint: string;
  verified: boolean;
  acknowledged?: boolean;
  deviceId: string | null;
  pinnedAt: number;
}

export interface SealedTrustStore {
  get(origin: string): Promise<SealedTrustRecord | null>;
  set(origin: string, record: SealedTrustRecord): Promise<void>;
  clear(origin: string): Promise<void>;
}

const TRUST_KEY_PREFIX = "bb.sealed.trust:";

const trustRecordSchema = z
  .object({
    serverKey: z.string().min(1),
    fingerprint: z.string().min(1),
    verified: z.boolean(),
    acknowledged: z.boolean().optional(),
    deviceId: z.string().min(1).nullable(),
    pinnedAt: z.number(),
  })
  .strict();

const STORAGE_UNAVAILABLE = Symbol("storage-unavailable");

function isTrustRecord(value: unknown): value is SealedTrustRecord {
  return trustRecordSchema.safeParse(value).success;
}

export function createLocalTrustStore(): SealedTrustStore {
  const desktop =
    typeof window === "undefined" ? undefined : window.bbDesktop?.sealed;
  const local = createStorageTrustStore();
  if (desktop === undefined) return local;
  return {
    async get(origin) {
      const mirrored = await desktop.getTrust(origin);
      const record = await local.get(origin);
      if (mirrored === null) return record;
      if (record !== null && record.serverKey === mirrored.serverKey) {
        return { ...record, verified: record.verified || mirrored.verified };
      }
      return {
        serverKey: mirrored.serverKey,
        fingerprint: mirrored.fingerprint,
        verified: mirrored.verified,
        deviceId: record?.deviceId ?? null,
        pinnedAt: record?.pinnedAt ?? Date.now(),
      };
    },
    async set(origin, record) {
      await local.set(origin, record);
      await desktop.setTrust(origin, {
        serverKey: record.serverKey,
        fingerprint: record.fingerprint,
        verified: record.verified,
      });
    },
    async clear(origin) {
      await local.clear(origin);
      await desktop.setTrust(origin, null);
    },
  };
}

function createStorageTrustStore(): SealedTrustStore {
  return {
    async get(origin) {
      const raw = withLocalStorage<string | null | typeof STORAGE_UNAVAILABLE>(
        (storage) => storage.getItem(`${TRUST_KEY_PREFIX}${origin}`),
        STORAGE_UNAVAILABLE,
      );
      if (raw === STORAGE_UNAVAILABLE || raw === null) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("the pinned server key for this bb is unreadable");
      }
      if (!isTrustRecord(parsed)) {
        throw new Error("the pinned server key for this bb is unreadable");
      }
      return parsed;
    },
    async set(origin, record) {
      const key = `${TRUST_KEY_PREFIX}${origin}`;
      const serialized = JSON.stringify(record);
      const stored = withLocalStorage<
        string | null | typeof STORAGE_UNAVAILABLE
      >((storage) => {
        storage.setItem(key, serialized);
        return storage.getItem(key);
      }, STORAGE_UNAVAILABLE);
      if (stored !== serialized) {
        throw new Error(
          "this browser could not store the pinned server key; sealed connections need browser storage",
        );
      }
    },
    async clear(origin) {
      withLocalStorage((storage) => {
        storage.removeItem(`${TRUST_KEY_PREFIX}${origin}`);
      }, undefined);
    },
  };
}
