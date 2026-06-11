import { eq } from "drizzle-orm";
import { defaultExperiments, type Experiments } from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { systemExperiments } from "../schema.js";

const SYSTEM_EXPERIMENTS_ROW_ID = "current";

export function getExperiments(db: DbConnection): Experiments {
  const row = db
    .select({
      claudeCodeMockCliTraffic: systemExperiments.claudeCodeMockCliTraffic,
      workflows: systemExperiments.workflows,
    })
    .from(systemExperiments)
    .where(eq(systemExperiments.id, SYSTEM_EXPERIMENTS_ROW_ID))
    .get();

  return row ?? defaultExperiments;
}

export function setExperiments(
  db: DbConnection,
  experiments: Experiments,
): void {
  const updatedAt = Date.now();
  db.insert(systemExperiments)
    .values({
      id: SYSTEM_EXPERIMENTS_ROW_ID,
      claudeCodeMockCliTraffic: experiments.claudeCodeMockCliTraffic,
      workflows: experiments.workflows,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: systemExperiments.id,
      set: {
        claudeCodeMockCliTraffic: experiments.claudeCodeMockCliTraffic,
        workflows: experiments.workflows,
        updatedAt,
      },
    })
    .run();
}
