import { inArray } from "drizzle-orm";
import {
  defaultExperiments,
  experimentKeys,
  experimentKeySchema,
  type Experiments,
} from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { systemExperiments } from "../schema.js";

export function getExperiments(db: DbConnection): Experiments {
  const experiments = { ...defaultExperiments };
  const rows = db
    .select()
    .from(systemExperiments)
    .where(inArray(systemExperiments.key, [...experimentKeys]))
    .all();

  for (const row of rows) {
    const key = experimentKeySchema.safeParse(row.key);
    if (key.success) {
      experiments[key.data] = row.value;
    }
  }

  return experiments;
}

export function setExperiments(
  db: DbConnection,
  experiments: Experiments,
): void {
  const updatedAt = Date.now();
  db.transaction((transaction) => {
    for (const key of experimentKeys) {
      transaction
        .insert(systemExperiments)
        .values({ key, value: experiments[key], updatedAt })
        .onConflictDoUpdate({
          target: systemExperiments.key,
          set: { value: experiments[key], updatedAt },
        })
        .run();
    }
  });
}
