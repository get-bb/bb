import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import {
  actionsApi,
  cacheFamily,
  cacheCleanupPlan,
  cacheUsageTable,
  listActionsCaches,
} from "./lib/actions-cache.mjs";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--apply"))
  throw new Error("Usage: node scripts/cleanup-actions-caches.mjs [--apply]");
const api = actionsApi();
const caches = await listActionsCaches(api);
const defaultBranch = process.env.GITHUB_DEFAULT_BRANCH;
if (!defaultBranch) throw new Error("GITHUB_DEFAULT_BRANCH is required");
const currentHash = createHash("sha256")
  .update(createHash("sha256").update(readFileSync("pnpm-lock.yaml")).digest())
  .digest("hex");
const closedRefs = new Set();
for (const ref of new Set(
  caches
    .filter((cache) => cacheFamily(cache.key).startsWith("node-cache-"))
    .map((cache) => cache.ref),
)) {
  const match = /^refs\/pull\/(\d+)\/merge$/u.exec(ref);
  if (!match) continue;
  const pull = await api(`pulls/${match[1]}`);
  if (pull?.state === "closed") closedRefs.add(ref);
  else if (pull?.state !== "open")
    throw new Error("Invalid pull request state; refusing cleanup");
}
const plan = cacheCleanupPlan(caches, {
  currentHash,
  defaultRef: `refs/heads/${defaultBranch}`,
  closedRefs,
  now: Date.now(),
});
const apply = args.includes("--apply");
const report = [
  cacheUsageTable(caches),
  "",
  `${apply ? "Cleanup" : "Dry run"}: ${plan.length} obsolete pnpm caches, ${(plan.reduce((bytes, cache) => bytes + cache.size_in_bytes, 0) / 1024 ** 3).toFixed(2)} GiB.`,
  ...plan.map((cache) => `- ${cache.id}: ${cache.ref}, ${cache.key}`),
].join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
if (apply) {
  for (const cache of plan) {
    await api(`actions/caches/${cache.id}`, "DELETE");
    console.log(`Deleted cache ${cache.id}`);
  }
}
