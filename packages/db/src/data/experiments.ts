import { eq, inArray } from "drizzle-orm";
import {
  appSettingsSchema,
  defaultExperiments,
  earlyAdopterExperiments,
  experimentKeys,
  experimentKeySchema,
  type ExperimentUpdates,
  type Experiments,
} from "@bb/domain";
import {
  prepareCachedQuery,
  type DbConnection,
  type DbQueryConnection,
} from "../connection.js";
import { appSettingsValues, systemExperiments } from "../schema.js";
import {
  deepFreeze,
  sameStoredSettingRows,
  type StoredSettingRow,
} from "./stored-setting-rows.js";

const prepareEarlyAdopterRow = (db: DbQueryConnection) =>
  db
    .select({ key: appSettingsValues.key, value: appSettingsValues.value })
    .from(appSettingsValues)
    .where(
      eq(appSettingsValues.key, appSettingsSchema.keyof().enum.earlyAdopter),
    )
    .prepare();

const prepareExperimentRows = (db: DbQueryConnection) =>
  db
    .select({ key: systemExperiments.key, value: systemExperiments.value })
    .from(systemExperiments)
    .where(inArray(systemExperiments.key, [...experimentKeys]))
    .orderBy(systemExperiments.key)
    .prepare();

const parsedExperiments = new WeakMap<
  DbConnection,
  { rows: StoredSettingRow[]; experiments: Experiments }
>();

function parseStoredBoolean(text: string): boolean {
  try {
    return JSON.parse(text) === true;
  } catch {
    return false;
  }
}

export function getExperiments(db: DbConnection): Experiments {
  const earlyAdopterRow = prepareCachedQuery(db, prepareEarlyAdopterRow).get();
  const experimentRows = prepareCachedQuery(db, prepareExperimentRows).all();
  const rows: StoredSettingRow[] = [
    ...(earlyAdopterRow === undefined ? [] : [earlyAdopterRow]),
    ...experimentRows.map((row) => ({
      key: `experiment:${row.key}`,
      value: String(row.value),
    })),
  ];
  const cached = parsedExperiments.get(db);
  if (cached !== undefined && sameStoredSettingRows(cached.rows, rows)) {
    return cached.experiments;
  }
  const experiments =
    earlyAdopterRow !== undefined && parseStoredBoolean(earlyAdopterRow.value)
      ? { ...earlyAdopterExperiments }
      : { ...defaultExperiments };
  for (const row of experimentRows) {
    const key = experimentKeySchema.safeParse(row.key);
    if (key.success) {
      experiments[key.data] = row.value;
    }
  }
  deepFreeze(experiments);
  parsedExperiments.set(db, { rows, experiments });
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
