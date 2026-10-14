import {
  DEVICE_SURFACES,
  base64UrlDecode,
  base64UrlEncode,
  bytesEqual,
  deviceIdFromPublicKey,
  isValidPublicKey,
  keyFingerprint,
  type DeviceDescriptor,
  type DeviceSurface,
} from "@bb/sealed-channel";
import type { SealedKvStorage } from "./kv.js";
import { z } from "zod";

export const SEALED_DEVICE_KV_PREFIX = "sealed-device:";

export const DEVICE_STATUSES = ["pending", "approved", "revoked"] as const;
export type SealedDeviceStatus = (typeof DEVICE_STATUSES)[number];

const storedDeviceSchema = z
  .object({
    id: z.string().min(1),
    publicKey: z.string().min(1),
    name: z.string().min(1),
    surface: z.enum(DEVICE_SURFACES),
    status: z.enum(DEVICE_STATUSES),
    createdAt: z.number().int().nonnegative(),
    approvedAt: z.number().int().nonnegative().nullable(),
    revokedAt: z.number().int().nonnegative().nullable(),
    lastSeenAt: z.number().int().nonnegative().nullable(),
    approvedVia: z
      .enum(["device-code", "manual", "delegation", "account-gate"])
      .nullable(),
    parentId: z.string().min(1).nullable().default(null),
    delegationExpiresAt: z.number().int().positive().nullable().default(null),
    policyGeneration: z.number().int().nonnegative().default(0),
  })
  .strict();

export type SealedDeviceRecord = z.infer<typeof storedDeviceSchema>;

export interface RegisterDeviceOptions {
  parentId?: string | null;
  delegationExpiresAt?: number | null;
  generation?: number;
}

export interface SealedDeviceView extends SealedDeviceRecord {
  fingerprint: string;
}

export interface DeviceRegistry {
  list(): Promise<SealedDeviceView[]>;
  get(id: string): Promise<SealedDeviceView | null>;
  findByPublicKey(publicKey: Uint8Array): Promise<SealedDeviceView | null>;
  register(
    device: DeviceDescriptor,
    status: Exclude<SealedDeviceStatus, "revoked">,
    approvedVia: SealedDeviceRecord["approvedVia"],
    options?: RegisterDeviceOptions,
  ): Promise<SealedDeviceView>;
  approve(
    id: string,
    approvedVia?: NonNullable<SealedDeviceRecord["approvedVia"]>,
    generation?: number,
  ): Promise<SealedDeviceView | null>;
  revoke(id: string): Promise<SealedDeviceView | null>;
  remove(id: string): Promise<boolean>;
  childrenOf(id: string): Promise<SealedDeviceView[]>;
  demote(id: string): Promise<SealedDeviceView | null>;
  touch(id: string): Promise<void>;
}

function toView(record: SealedDeviceRecord): SealedDeviceView {
  return {
    ...record,
    fingerprint: keyFingerprint(base64UrlDecode(record.publicKey)),
  };
}

export function isDeviceSurface(value: string): value is DeviceSurface {
  return (DEVICE_SURFACES as readonly string[]).includes(value);
}

export function createKvDeviceRegistry(
  kv: Pick<SealedKvStorage, "get" | "set" | "delete" | "list">,
  now: () => number = Date.now,
): DeviceRegistry {
  const key = (id: string) => `${SEALED_DEVICE_KV_PREFIX}${id}`;

  async function read(id: string): Promise<SealedDeviceRecord | null> {
    const raw = await kv.get<unknown>(key(id));
    const parsed = storedDeviceSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  async function write(record: SealedDeviceRecord): Promise<SealedDeviceView> {
    await kv.set(key(record.id), record);
    return toView(record);
  }

  const locks = new Map<string, Promise<unknown>>();
  function serialized<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = locks.get(id) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    locks.set(id, settled);
    void settled.then(() => {
      if (locks.get(id) === settled) locks.delete(id);
    });
    return run;
  }

  return {
    async list() {
      const keys = await kv.list(SEALED_DEVICE_KV_PREFIX);
      const records = await Promise.all(
        keys.map((entry) => read(entry.slice(SEALED_DEVICE_KV_PREFIX.length))),
      );
      return records
        .filter((record): record is SealedDeviceRecord => record !== null)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(toView);
    },
    async get(id) {
      const record = await read(id);
      return record === null ? null : toView(record);
    },
    async findByPublicKey(publicKey) {
      if (!isValidPublicKey(publicKey)) return null;
      const record = await read(deviceIdFromPublicKey(publicKey));
      if (record === null) return null;
      if (!bytesEqual(base64UrlDecode(record.publicKey), publicKey)) {
        return null;
      }
      return toView(record);
    },
    register(device, status, approvedVia, options = {}) {
      const id = deviceIdFromPublicKey(device.publicKey);
      return serialized(id, async () => {
        const existing = await read(id);
        const timestamp = now();
        const encodedKey = base64UrlEncode(device.publicKey);
        if (existing !== null && existing.publicKey !== encodedKey) {
          throw new Error(
            `sealed device id ${id} collides with a different key`,
          );
        }
        if (existing !== null) {
          if (existing.status === "revoked") return toView(existing);
          const next: SealedDeviceRecord = {
            ...existing,
            name: device.name,
            surface: device.surface,
            lastSeenAt: timestamp,
            ...(options.parentId !== undefined
              ? { parentId: options.parentId }
              : {}),
            ...(options.delegationExpiresAt !== undefined
              ? { delegationExpiresAt: options.delegationExpiresAt }
              : {}),
          };
          return write(next);
        }
        return write({
          id,
          publicKey: encodedKey,
          name: device.name,
          surface: device.surface,
          status,
          createdAt: timestamp,
          approvedAt: status === "approved" ? timestamp : null,
          revokedAt: null,
          lastSeenAt: timestamp,
          approvedVia: status === "approved" ? approvedVia : null,
          parentId: options.parentId ?? null,
          delegationExpiresAt: options.delegationExpiresAt ?? null,
          policyGeneration: options.generation ?? 0,
        });
      });
    },
    approve(id, approvedVia = "manual", generation = 0) {
      return serialized(id, async () => {
        const record = await read(id);
        if (record === null || record.status === "revoked") return null;
        if (record.status === "approved") return toView(record);
        return write({
          ...record,
          status: "approved",
          approvedAt: now(),
          revokedAt: null,
          approvedVia,
          policyGeneration: generation,
        });
      });
    },
    revoke(id) {
      return serialized(id, async () => {
        const record = await read(id);
        if (record === null) return null;
        if (record.status === "revoked") return toView(record);
        return write({ ...record, status: "revoked", revokedAt: now() });
      });
    },
    remove(id) {
      return serialized(id, async () => {
        const record = await read(id);
        if (record === null) return false;
        await kv.delete(key(id));
        return true;
      });
    },
    touch(id) {
      return serialized(id, async () => {
        const record = await read(id);
        if (record === null) return;
        await write({ ...record, lastSeenAt: now() });
      });
    },
    demote(id) {
      return serialized(id, async () => {
        const record = await read(id);
        if (record === null || record.status !== "approved") return null;
        return write({
          ...record,
          status: "pending",
          approvedAt: null,
          approvedVia: null,
        });
      });
    },
    async childrenOf(id) {
      const all = await this.list();
      return all.filter((device) => device.parentId === id);
    },
  };
}
