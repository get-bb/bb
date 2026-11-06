import { readFileSync, writeFileSync } from "node:fs";

const MAX_OOM_SCORE_ADJ = 1_000;
const WORKLOAD_OOM_SCORE_ADJ_RAISE = 500;

export function preferOutOfMemoryKill(pid: number | undefined): void {
  if (process.platform !== "linux" || pid === undefined) return;
  try {
    const ownScore = Number.parseInt(
      readFileSync("/proc/self/oom_score_adj", "utf8"),
      10,
    );
    if (!Number.isSafeInteger(ownScore)) return;
    writeFileSync(
      `/proc/${pid}/oom_score_adj`,
      String(
        Math.min(MAX_OOM_SCORE_ADJ, ownScore + WORKLOAD_OOM_SCORE_ADJ_RAISE),
      ),
    );
  } catch {
    return;
  }
}
