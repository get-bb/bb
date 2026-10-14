import {
  deserializeSigningKeyPair,
  generateSigningKeyPair,
  serializeSigningKeyPair,
  type SerializedSigningKeyPair,
  type SigningKeyPair,
} from "@bb/sealed-channel";
import type { SealedKvStorage } from "./kv.js";
import { z } from "zod";

export const SEALED_IDENTITY_KV_KEY = "sealed-identity";

const storedIdentitySchema = z
  .object({
    version: z.literal(1),
    publicKey: z.string().min(1),
    secretKey: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export interface ServerIdentityRecord {
  pair: SigningKeyPair;
  createdAt: number;
}

export interface ServerIdentityStore {
  load(): Promise<ServerIdentityRecord>;
  rotate(): Promise<ServerIdentityRecord>;
}

export function createKvServerIdentityStore(
  kv: Pick<SealedKvStorage, "get" | "set">,
  now: () => number = Date.now,
): ServerIdentityStore {
  let cached: ServerIdentityRecord | null = null;
  let loading: Promise<ServerIdentityRecord> | null = null;

  async function persist(pair: SigningKeyPair, createdAt: number) {
    const serialized: SerializedSigningKeyPair = serializeSigningKeyPair(pair);
    await kv.set(SEALED_IDENTITY_KV_KEY, {
      version: 1,
      publicKey: serialized.publicKey,
      secretKey: serialized.secretKey,
      createdAt,
    });
    cached = { pair, createdAt };
    return cached;
  }

  return {
    load() {
      if (cached !== null) return Promise.resolve(cached);
      loading ??= (async () => {
        const raw = await kv.get<unknown>(SEALED_IDENTITY_KV_KEY);
        if (raw === undefined) return persist(generateSigningKeyPair(), now());
        const parsed = storedIdentitySchema.safeParse(raw);
        if (!parsed.success) {
          throw new Error(
            "stored sealed identity is unreadable; run `bb connect rotate-key --yes` to replace it",
          );
        }
        const pair = deserializeSigningKeyPair(parsed.data);
        cached = { pair, createdAt: parsed.data.createdAt };
        return cached;
      })().finally(() => {
        loading = null;
      });
      return loading;
    },
    async rotate() {
      if (loading !== null) await loading.catch(() => undefined);
      return persist(generateSigningKeyPair(), now());
    },
  };
}
