import type { PGlite } from "@electric-sql/pglite";
import type { PgQueryable } from "./pg-client.js";

const INT8_OID = 20;

export function pgliteQueryable(pglite: PGlite): PgQueryable {
  return {
    async queryArrays(text, params) {
      const result = await pglite.query<unknown[]>(text, [...params], {
        rowMode: "array",
        parsers: { [INT8_OID]: (value: string) => Number(value) },
      });
      return { rows: result.rows, rowCount: result.affectedRows ?? 0 };
    },
  };
}
