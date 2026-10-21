export function createResourceReadCache<Value>(
  load: (key: string, force: boolean, signal: AbortSignal) => Promise<Value>,
) {
  type Entry = {
    value: Value | undefined;
    error: Error | null;
    updatedAt: number;
    attemptedAt: number;
    revision: number;
    controller: AbortController;
    pending?: { force: boolean; promise: Promise<void> };
  };
  const entries = new Map<string, Entry>();
  let disposed = false;
  const read = async (
    key: string,
    options: { force: boolean; maxAgeMs: number },
  ): Promise<{ value: Value | undefined; error: Error | null }> => {
    if (disposed) throw new Error("Resource cache is disposed.");
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        value: undefined,
        error: null,
        updatedAt: 0,
        attemptedAt: 0,
        revision: 0,
        controller: new AbortController(),
      };
      entries.set(key, entry);
    }
    const current = entry;
    const running = current.pending;
    if (running) {
      await running.promise;
      if (!options.force || running.force)
        return { value: current.value, error: current.error };
      current.controller.signal.throwIfAborted();
      return read(key, options);
    }
    if (
      !options.force &&
      current.value !== undefined &&
      Date.now() - Math.max(current.updatedAt, current.attemptedAt) <
        options.maxAgeMs
    )
      return { value: current.value, error: current.error };
    const collect = async (): Promise<Value> => {
      for (;;) {
        const revision = current.revision;
        try {
          const value = await load(
            key,
            options.force,
            current.controller.signal,
          );
          current.controller.signal.throwIfAborted();
          if (revision === current.revision) return value;
        } catch (error) {
          if (
            revision === current.revision ||
            current.controller.signal.aborted
          )
            throw error;
        }
      }
    };
    const promise = collect()
      .then((value) => {
        current.controller.signal.throwIfAborted();
        current.value = value;
        current.updatedAt = Date.now();
        current.error = null;
      })
      .catch((error: unknown) => {
        current.error =
          error instanceof Error ? error : new Error(String(error));
      })
      .finally(() => {
        current.attemptedAt = Date.now();
        current.pending = undefined;
      });
    current.pending = { force: options.force, promise };
    await promise;
    return { value: current.value, error: current.error };
  };
  const expire = () => {
    for (const entry of entries.values()) {
      entry.updatedAt = 0;
      entry.attemptedAt = 0;
    }
  };
  return {
    read,
    expire,
    peek(key: string) {
      const entry = entries.get(key);
      return entry ? { value: entry.value, error: entry.error } : undefined;
    },
    retain(
      keys: ReadonlySet<string>,
      belongsTo: (key: string) => boolean = () => true,
    ) {
      for (const [key, entry] of entries)
        if (belongsTo(key) && !keys.has(key)) {
          entry.controller.abort();
          entries.delete(key);
        }
    },
    invalidate() {
      for (const entry of entries.values()) entry.revision++;
      expire();
    },
    dispose() {
      disposed = true;
      for (const entry of entries.values()) entry.controller.abort();
      entries.clear();
    },
  };
}
