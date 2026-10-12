import { performance } from "node:perf_hooks";
import type Database from "better-sqlite3";

export const SQLITE_IDLE = 0;
export const SQLITE_RUNNING = 1;
export const SQLITE_STOPPING = 2;

/** A cancellation barrier around every native SQLite entry used by the worker.
 * Terminating V8 while better-sqlite3 constructs an exception can abort the
 * entire process. The parent must acquire IDLE -> STOPPING before termination.
 * Future native calls then fail in JavaScript instead of entering the addon.
 */
export function createSqliteExecutionGate(
  buffer: SharedArrayBuffer,
  onNativeComplete: (durationMs: number) => void = () => {},
  beforeNative: () => void = () => {},
) {
  const state = new Int32Array(buffer);
  let depth = 0;
  function native<T>(work: () => T): T {
    if (
      depth === 0 &&
      Atomics.compareExchange(state, 0, SQLITE_IDLE, SQLITE_RUNNING) !==
        SQLITE_IDLE
    ) {
      throw new Error("The database worker was canceled.");
    }
    const started = depth === 0 ? performance.now() : null;
    depth++;
    try {
      if (depth === 1) beforeNative();
      return work();
    } finally {
      depth--;
      if (depth === 0) {
        if (started !== null) onNativeComplete(performance.now() - started);
        Atomics.store(state, 0, SQLITE_IDLE);
      }
    }
  }
  function wrapStatement(statement: Database.Statement): Database.Statement {
    const all = statement.all.bind(statement);
    const get = statement.get.bind(statement);
    const run = statement.run.bind(statement);
    statement.all = (...bindings) => native(() => all(...bindings));
    statement.get = (...bindings) => native(() => get(...bindings));
    statement.run = (...bindings) => native(() => run(...bindings));
    const bind = statement.bind.bind(statement);
    const columns = statement.columns.bind(statement);
    const raw = statement.raw.bind(statement);
    const pluck = statement.pluck.bind(statement);
    const expand = statement.expand.bind(statement);
    const safeIntegers = statement.safeIntegers.bind(statement);
    statement.bind = (...bindings) => native(() => bind(...bindings));
    statement.columns = () => native(() => columns());
    statement.raw = (enabled) =>
      native(() => (enabled === undefined ? raw() : raw(enabled)));
    statement.pluck = (enabled) =>
      native(() => (enabled === undefined ? pluck() : pluck(enabled)));
    statement.expand = (enabled) =>
      native(() => (enabled === undefined ? expand() : expand(enabled)));
    statement.safeIntegers = (enabled) =>
      native(() =>
        enabled === undefined ? safeIntegers() : safeIntegers(enabled),
      );
    return statement;
  }
  function protect(sqlite: Database.Database): void {
    const prepare = sqlite.prepare.bind(sqlite);
    Object.defineProperty(sqlite, "prepare", {
      configurable: true,
      value: (source: string) => native(() => wrapStatement(prepare(source))),
    });
    Object.defineProperty(sqlite, "transaction", {
      configurable: true,
      value: () => {
        throw new Error(
          "This worker requires explicit transaction statements.",
        );
      },
    });
    const exec = sqlite.exec.bind(sqlite);
    const pragma = sqlite.pragma.bind(sqlite);
    const loadExtension = sqlite.loadExtension.bind(sqlite);
    const close = sqlite.close.bind(sqlite);
    sqlite.exec = (source) => native(() => exec(source));
    sqlite.pragma = (source, options) => native(() => pragma(source, options));
    sqlite.loadExtension = (path) => native(() => loadExtension(path));
    sqlite.close = () => native(() => close());
  }
  return { native, protect };
}
