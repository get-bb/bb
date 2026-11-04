import { Client, types } from "pg";

const INT8_OID = 20;

const pgTypes = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    if (oid === INT8_OID) return (value: string) => Number(value);
    return types.getTypeParser(oid, format);
  },
};

export interface PgQueryResult {
  rows: unknown[][];
  rowCount: number | null;
}

export interface PgQueryable {
  queryArrays(text: string, params: readonly unknown[]): Promise<PgQueryResult>;
}

export interface PgConnection extends PgQueryable {
  client(): Promise<Client>;
  close(): Promise<void>;
}

export function connectPg(connectionString: string): PgConnection {
  let client: Promise<Client> | null = null;
  const connected = (): Promise<Client> => {
    if (client === null) {
      const next = new Client({ connectionString, types: pgTypes });
      client = next.connect().then(
        () => next,
        (error: unknown) => {
          client = null;
          throw error;
        },
      );
    }
    return client;
  };
  return {
    client: connected,
    async queryArrays(text, params) {
      const result = await (
        await connected()
      ).query<unknown[]>({
        text,
        values: [...params],
        rowMode: "array",
      });
      return { rows: result.rows, rowCount: result.rowCount };
    },
    async close() {
      const current = client;
      client = null;
      if (current === null) return;
      await (await current).end();
    },
  };
}
