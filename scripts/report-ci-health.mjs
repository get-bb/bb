import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { actionsApi } from "./lib/actions-cache.mjs";
import {
  collectCiHealth,
  summarizeCiHealth,
  ciHealthMarkdown,
} from "./lib/ci-health.mjs";

const until = new Date().toISOString();
const since = new Date(Date.parse(until) - 86_400_000).toISOString();
const runs = await collectCiHealth(actionsApi(), since, until);
const report = { since, until, ...summarizeCiHealth(runs) };
const markdown = ciHealthMarkdown(report);
mkdirSync(".ci-health", { recursive: true });
writeFileSync(".ci-health/report.json", JSON.stringify(report, null, 2));
writeFileSync(".ci-health/runs.json", JSON.stringify(runs));
writeFileSync(".ci-health/report.md", markdown);
console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
