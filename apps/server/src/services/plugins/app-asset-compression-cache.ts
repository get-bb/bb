interface CachedAppAssetEncodings {
  hash: string;
  variants: Map<string, Promise<Buffer>>;
}

export interface AppAssetCompressionCache {
  getOrCreate(args: {
    assetKey: string;
    compress: () => Promise<Buffer>;
    encoding: string;
    hash: string;
  }): Promise<Buffer>;
}

/**
 * Bounded LRU of encoded plugin asset variants. Promises enter the cache
 * before compression finishes so parallel requests share one zlib operation;
 * a changed content hash replaces every variant for that asset.
 */
export function createAppAssetCompressionCache(
  maxEntries: number,
): AppAssetCompressionCache {
  const entries = new Map<string, CachedAppAssetEncodings>();

  return {
    getOrCreate(args) {
      let entry = entries.get(args.assetKey);
      if (entry === undefined || entry.hash !== args.hash) {
        entry = { hash: args.hash, variants: new Map() };
        entries.set(args.assetKey, entry);
      } else {
        // Re-insert to mark this asset as most recently used.
        entries.delete(args.assetKey);
        entries.set(args.assetKey, entry);
      }

      const cached = entry.variants.get(args.encoding);
      if (cached !== undefined) {
        return cached;
      }

      let compression: Promise<Buffer>;
      compression = args.compress().catch((error: unknown) => {
        if (entry.variants.get(args.encoding) === compression) {
          entry.variants.delete(args.encoding);
        }
        throw error;
      });
      entry.variants.set(args.encoding, compression);

      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) {
          break;
        }
        entries.delete(oldestKey);
      }
      return compression;
    },
  };
}
