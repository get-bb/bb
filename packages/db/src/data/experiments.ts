import { inArray } from "drizzle-orm";
import {
  defaultExperiments,
  earlyAdopterExperiments,
  experimentKeys,
  experimentKeySchema,
  type ExperimentUpdates,
  type Experiments,
} from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { systemExperiments } from "../schema.js";
import { getEarlyAdopter } from "./app-settings.js";

export function getExperiments(db: DbConnection): Experiments {
  const experiments = getEarlyAdopter(db)
    ? { ...earlyAdopterExperiments }
    : { ...defaultExperiments };
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
  updates: ExperimentUpdates,
): void {
  const updatedAt = Date.now();
  db.transaction((transaction) => {
    for (const key of experimentKeys) {
      const value = updates[key];
      if (value === undefined) continue;
      transaction
        .insert(systemExperiments)
        .values({ key, value, updatedAt })
        .onConflictDoUpdate({
          target: systemExperiments.key,
          set: { value, updatedAt },
        })
        .run();
    }
  });
}
