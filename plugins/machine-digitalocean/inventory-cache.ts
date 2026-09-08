import type { Vendor } from "./vendor.js";

export function createReadCache<T>(now: () => number = Date.now) {
  const entries = new Map<string, { expiresAt: number; value: Promise<T> }>();
  return {
    clear() {
      entries.clear();
    },
    async get(
      key: string,
      signal: AbortSignal,
      read: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
      signal.throwIfAborted();
      let entry = entries.get(key);
      if (!entry || entry.expiresAt <= now()) {
        if (entries.size >= 128) {
          const oldest = entries.keys().next().value;
          if (oldest !== undefined) entries.delete(oldest);
        }
        const fresh = {
          expiresAt: Infinity,
          value: Promise.resolve().then(() =>
            read(AbortSignal.timeout(30_000)),
          ),
        };
        entries.set(key, fresh);
        fresh.value = fresh.value.then(
          (value) => {
            fresh.expiresAt = now() + 30_000;
            return value;
          },
          (error: unknown) => {
            if (entries.get(key) === fresh) entries.delete(key);
            throw error;
          },
        );
        entry = fresh;
      }
      const value = entry.value;
      return new Promise<T>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        value
          .then(resolve, reject)
          .finally(() => signal.removeEventListener("abort", abort));
      });
    },
  };
}

export function cacheVendorInventory(api: Vendor, now: () => number): Vendor {
  const cache = createReadCache<Awaited<ReturnType<Vendor["inventory"]>>>(now);
  async function mutate<T>(run: () => Promise<T>) {
    cache.clear();
    try {
      return await run();
    } finally {
      cache.clear();
    }
  }
  return {
    ...api,
    inventory: (id, signal) =>
      cache.get(String(id), signal, (shared) => api.inventory(id, shared)),
    create: (...args) => mutate(() => api.create(...args)),
    power: (...args) => mutate(() => api.power(...args)),
    snapshot: (...args) => mutate(() => api.snapshot(...args)),
    deleteSnapshot: (...args) => mutate(() => api.deleteSnapshot(...args)),
    destroy: (...args) => mutate(() => api.destroy(...args)),
  };
}
