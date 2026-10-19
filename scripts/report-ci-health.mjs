import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { actionsApi } from "./lib/actions-cache.mjs";
import {
  collectCiHealth,
  summarizeCiHealth,
  ciHealthMarkdown,
} from "./lib/ci-health.mjs";

const until = new Date().toISOString();
const since = new Date(Date.parse(until) - 86_400_000).toISOString();
mkdirSync(".ci-health", { recursive: true });
function saveReport(evidence) {
  const collection = {
    inventoryComplete: evidence.inventoryComplete,
    errors: evidence.errors,
  };
  const report = {
    since,
    until,
    collection,
    ...summarizeCiHealth(evidence.runs),
  };
  const markdown = ciHealthMarkdown(report);
  writeFileSync(".ci-health/runs.json", JSON.stringify(evidence.runs));
  writeFileSync(
    ".ci-health/collection.json",
    JSON.stringify(collection, null, 2),
  );
  writeFileSync(".ci-health/report.json", JSON.stringify(report, null, 2));
  writeFileSync(".ci-health/report.md", markdown);
  return markdown;
}
const evidence = await collectCiHealth(actionsApi(), since, until, saveReport);
const markdown = saveReport(evidence);
console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
if (!evidence.inventoryComplete || evidence.errors.length > 0)
  process.exitCode = 1;
