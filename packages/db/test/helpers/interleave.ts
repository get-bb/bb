/**
 * Returns a connection that behaves exactly like the real one (every read and
 * write hits the real SQLite database) but runs `onFirstRead` immediately
 * after the first `.select()…\.get()` resolves — the only point where a
 * concurrent writer could interleave under an async executor. Used to
 * exercise the compare-and-set branch of the lifecycle writers, which
 * better-sqlite3's synchronous transactions make unreachable through the
 * public API alone.
 */
export function withWriteAfterFirstRead<T extends object>(
  connection: T,
  onFirstRead: () => void,
): T {
  let pending: (() => void) | null = onFirstRead;
  const wrapBuilder = (builder: object): object =>
    new Proxy(builder, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== "function") {
          return value;
        }
        return (...callArgs: never[]) => {
          const result = Reflect.apply(value, target, callArgs);
          if (property === "get") {
            const trigger = pending;
            pending = null;
            trigger?.();
            return result;
          }
          return result !== null && typeof result === "object"
            ? wrapBuilder(result)
            : result;
        };
      },
    });
  return new Proxy(connection, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "select" || typeof value !== "function") {
        return value;
      }
      return (...callArgs: never[]) =>
        wrapBuilder(Reflect.apply(value, target, callArgs));
    },
  });
}
