import {
  appendFileSync,
  existsSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import {
  readDurationRecords,
  summarizeTestHeadroom,
  testHeadroomMarkdown,
} from "./lib/test-headroom.mjs";

const [
  root = ".ci-health/test-durations",
  output = ".ci-health/test-headroom.md",
] = process.argv.slice(2);
const runs = existsSync(root) ? readdirSync(root).length : 0;
const records = existsSync(root) ? readDurationRecords(root) : [];
const markdown = testHeadroomMarkdown(summarizeTestHeadroom(records), runs);
writeFileSync(output, `${markdown}\n`);
console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${markdown}\n`);
}
