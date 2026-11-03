import {
  importGateKeySet,
  parseGateKeySet,
  verifyGateAssertion,
  type GateAssertionResult,
} from "@bb/tunnel-contract/next";
import type { ServerLogger } from "../../types.js";

export const GATE_KEYS_REFETCH_INTERVAL_MS = 60_000;
export const GATE_KEYS_MAX_AGE_MS = 15 * 60_000;
const GATE_KEYS_FETCH_TIMEOUT_MS = 10_000;

export type GateKeyVerification =
  | GateAssertionResult
  | { ok: false; reason: "no_keys" };

export interface GateKeyVerifyInput {
  audience: string;
  method: string;
  pathAndQuery: string;
}

export interface GateKeyStore {
  verify(
    token: string,
    input: GateKeyVerifyInput,
  ): Promise<GateKeyVerification>;
}

export interface CreateGateKeyStoreArgs {
  url: () => string;
  logger: Pick<ServerLogger, "debug" | "warn">;
  now: () => number;
}

export function createGateKeyStore(args: CreateGateKeyStoreArgs): GateKeyStore {
  let keys: ReadonlyMap<string, CryptoKey> | null = null;
  let loadedAt = 0;
  let lastAttemptAt: number | null = null;
  let inFlight: Promise<void> | null = null;

  async function fetchKeys(): Promise<void> {
    const url = args.url();
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(GATE_KEYS_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`gate key set request returned ${response.status}`);
      }
      const keySet = parseGateKeySet(await response.json());
      if (keySet === null) {
        throw new Error("gate key set is malformed");
      }
      keys = await importGateKeySet(keySet);
      loadedAt = args.now();
      args.logger.debug(
        { url, kids: [...keys.keys()] },
        "Loaded bb connect gate keys",
      );
    } catch (error) {
      args.logger.warn(
        { err: error, url, keptPreviousKeys: keys !== null },
        "Failed to load bb connect gate keys",
      );
    }
  }

  function refetch(): Promise<void> {
    if (inFlight !== null) return inFlight;
    const now = args.now();
    if (
      lastAttemptAt !== null &&
      now - lastAttemptAt < GATE_KEYS_REFETCH_INTERVAL_MS
    ) {
      return Promise.resolve();
    }
    lastAttemptAt = now;
    inFlight = fetchKeys().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function verifyWith(
    current: ReadonlyMap<string, CryptoKey>,
    token: string,
    input: GateKeyVerifyInput,
  ): Promise<GateAssertionResult> {
    return verifyGateAssertion(token, {
      keys: current,
      audience: input.audience,
      method: input.method,
      pathAndQuery: input.pathAndQuery,
      nowSeconds: Math.floor(args.now() / 1000),
    });
  }

  return {
    async verify(token, input) {
      if (keys === null) {
        await refetch();
      } else if (args.now() - loadedAt >= GATE_KEYS_MAX_AGE_MS) {
        void refetch();
      }
      const initial = keys;
      if (initial === null) return { ok: false, reason: "no_keys" };
      const result = await verifyWith(initial, token, input);
      if (result.ok || result.reason !== "unknown_key") return result;
      await refetch();
      const refreshed = keys;
      if (refreshed === null || refreshed === initial) return result;
      return verifyWith(refreshed, token, input);
    },
  };
}
