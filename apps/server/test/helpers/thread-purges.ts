import type { AppDeps } from "../../src/types.js";
import { threadPurgeSweep } from "../../src/services/threads/thread-purge.js";

export async function runThreadPurges(
  deps: Pick<AppDeps, "db" | "hub" | "logger">,
): Promise<void> {
  await threadPurgeSweep(deps).run(deps, Date.now());
}
