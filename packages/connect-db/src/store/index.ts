import {
  type D1Like,
  type PgQueryable,
  d1Backend,
  pgBackend,
} from "./backends.js";
import type { ConnectDbBackends } from "./connect-db.js";
import type { ConnectDbMode, ConnectDbModeSource } from "./mode.js";

export * from "./backends.js";
export * from "./connect-db.js";
export * from "./mode.js";
export * from "./sqlite-to-pg.js";

export interface ConnectDbEnv extends ConnectDbModeSource {
  DB: D1Like;
}

export function connectDbBackends(
  env: ConnectDbEnv,
  mode: ConnectDbMode,
  pg: () => PgQueryable,
): ConnectDbBackends {
  const d1 = d1Backend(env.DB);
  return {
    primary: mode === "d1" || mode === "d1+pg" ? d1 : pgBackend(pg()),
    secondary:
      mode === "d1+pg" ? pgBackend(pg()) : mode === "pg+d1" ? d1 : null,
  };
}
