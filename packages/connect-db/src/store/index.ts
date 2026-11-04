import {
  type D1Like,
  type PgQueryable,
  d1Backend,
  pgBackend,
} from "./backends.js";
import type { ConnectDbBackends } from "./connect-db.js";
import type { ConnectDbFlags, ConnectDbModeSource } from "./mode.js";

export * from "./backends.js";
export * from "./connect-db.js";
export * from "./mode.js";
export * from "./sqlite-to-pg.js";

export interface ConnectDbEnv extends ConnectDbModeSource {
  DB: D1Like;
}

export function connectDbBackends(
  env: ConnectDbEnv,
  { mode, shadowReads }: ConnectDbFlags,
  pg: () => PgQueryable,
): ConnectDbBackends {
  const d1 = d1Backend(env.DB);
  return {
    shadowReads: mode === "d1+pg" ? shadowReads : 0,
    primary: mode === "d1" || mode === "d1+pg" ? d1 : pgBackend(pg()),
    secondary:
      mode === "d1+pg" ? pgBackend(pg()) : mode === "pg+d1" ? d1 : null,
  };
}
