import { eq } from "drizzle-orm";
import {
  defaultExperiments,
  experimentsSchema,
  type Experiments,
} from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import { appSettings } from "../schema.js";

type AppSettingsReadConnection = DbConnection | DbTransaction;
type AppSettingsWriteConnection = DbConnection | DbTransaction;

const EXPERIMENTS_KEY = "experiments";
const storedExperimentsSchema = experimentsSchema.partial();

/**
 * The user's opt-in experiments. A missing row or an unreadable/stale value
 * falls back to the defaults. Older stored objects merge over current
 * defaults so adding a new experiment does not reset existing opt-ins.
 */
export function getExperiments(db: AppSettingsReadConnection): Experiments {
  const row = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, EXPERIMENTS_KEY))
    .get();
  if (!row) {
    return defaultExperiments;
  }
  try {
    const parsed = storedExperimentsSchema.safeParse(JSON.parse(row.value));
    return parsed.success
      ? { ...defaultExperiments, ...parsed.data }
      : defaultExperiments;
  } catch {
    return defaultExperiments;
  }
}

export function setExperiments(
  db: AppSettingsWriteConnection,
  experiments: Experiments,
): void {
  const now = Date.now();
  db.insert(appSettings)
    .values({
      key: EXPERIMENTS_KEY,
      value: JSON.stringify(experiments),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: JSON.stringify(experiments), updatedAt: now },
    })
    .run();
}
