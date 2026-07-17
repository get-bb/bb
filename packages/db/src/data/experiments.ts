import { eq } from "drizzle-orm";
import { defaultExperiments, type Experiments } from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { systemExperiments } from "../schema.js";

const SYSTEM_EXPERIMENTS_ROW_ID = "current";

export function getExperiments(db: DbConnection): Experiments {
  const row = db
    .select({
      claudeCodeMockCliTraffic: systemExperiments.claudeCodeMockCliTraffic,
      threadSplits: systemExperiments.threadSplits,
      plugins: systemExperiments.plugins,
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
      threadSplits: experiments.threadSplits,
      plugins: experiments.plugins,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: systemExperiments.id,
      set: {
        claudeCodeMockCliTraffic: experiments.claudeCodeMockCliTraffic,
        threadSplits: experiments.threadSplits,
        plugins: experiments.plugins,
        updatedAt,
      },
    })
    .run();
}
