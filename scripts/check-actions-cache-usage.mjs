#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import {
  actionsApi,
  cacheUsageTable,
  listActionsCaches,
} from "./lib/actions-cache.mjs";

try {
  const caches = await listActionsCaches(actionsApi());
  const bytes = caches.reduce((total, cache) => total + cache.size_in_bytes, 0);
  const report = cacheUsageTable(caches);
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  if (bytes >= 7 * 1024 ** 3) {
    console.log(
      `::warning::GitHub-visible Actions caches use ${(bytes / 1024 ** 3).toFixed(2)} GiB. Review the cache-family summary and the CI Cache Maintenance workflow against the repository's configured quota.`,
    );
  }
} catch (error) {
  console.log(
    `::warning::Could not report Actions cache usage: ${error.message}`,
  );
}
