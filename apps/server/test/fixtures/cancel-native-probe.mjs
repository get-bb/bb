import { DatabaseReadService } from "../../src/services/database/database-read-service.ts";
import { access } from "node:fs/promises";
const databasePath = process.argv[2];
const reader = new DatabaseReadService({
  databasePath,
  executionTimeoutMs: 120,
  workerEntry: new URL("./slow-database-reader.mjs", import.meta.url),
  logger: { info() {} },
});
const task = (query) => ({
  kind: "search",
  query,
  limitPerGroup: 20,
  daemonSessions: [],
  planCommands: [],
});
try {
  const initial = await reader.run(task("rows"), new AbortController().signal);
  const expectedCount = JSON.parse(initial.json).rows.length;
  const abort = new AbortController();
  const slow = reader.run(task("slow"), abort.signal).then(
    () => {
      throw new Error("The slow query unexpectedly completed.");
    },
    () => {},
  );
  const end = performance.now() + 2000;
  while (true) {
    try {
      await access(databasePath + ".reader-ready");
      break;
    } catch {}
    if (performance.now() > end)
      throw new Error("The native operation did not start.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  abort.abort();
  await slow;
  const result = await reader.run(task("rows"), new AbortController().signal);
  if (
    JSON.parse(result.json).rows.length !== expectedCount ||
    result.workerGeneration !== 2
  )
    throw new Error("The replacement worker did not respond.");
  process.stdout.write("native cancellation and replacement passed\n");
} finally {
  await reader.close();
}
