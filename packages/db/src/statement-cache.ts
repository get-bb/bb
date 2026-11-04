import type Database from "better-sqlite3";

export const SQLITE_STATEMENT_CACHE_CAPACITY = 512;

const OWNING_STATEMENT_METHODS = [
  "bind",
  "pluck",
  "expand",
  "safeIntegers",
] as const;

export function cacheSqliteStatements(
  sqlite: Database.Database,
  capacity: number = SQLITE_STATEMENT_CACHE_CAPACITY,
): void {
  const statements = new Map<string, Database.Statement>();
  const prepareUncached: Database.Database["prepare"] =
    sqlite.prepare.bind(sqlite);

  function release(source: string, statement: Database.Statement): void {
    if (statements.get(source) === statement) statements.delete(source);
  }

  function track(source: string, statement: Database.Statement): void {
    for (const method of OWNING_STATEMENT_METHODS) {
      const original = statement[method];
      Object.defineProperty(statement, method, {
        configurable: true,
        value(this: Database.Statement, ...args: unknown[]) {
          release(source, statement);
          return Reflect.apply(original, this, args);
        },
        writable: true,
      });
    }
  }

  function prepare(source: string): Database.Statement {
    const cached = statements.get(source);
    if (cached !== undefined) {
      statements.delete(source);
      if (!cached.busy) {
        statements.set(source, cached);
        if (cached.reader) cached.raw(false);
        return cached;
      }
    }
    const statement = prepareUncached(source);
    track(source, statement);
    statements.set(source, statement);
    if (statements.size > capacity) {
      const oldest = statements.keys().next();
      if (!oldest.done) statements.delete(oldest.value);
    }
    return statement;
  }

  Object.defineProperty(sqlite, "prepare", {
    configurable: true,
    value: prepare,
    writable: true,
  });

  const defaultSafeIntegers = sqlite.defaultSafeIntegers.bind(sqlite);
  sqlite.defaultSafeIntegers = (toggle) => {
    statements.clear();
    return defaultSafeIntegers(toggle);
  };

  const close = sqlite.close.bind(sqlite);
  sqlite.close = () => {
    statements.clear();
    return close();
  };
}
