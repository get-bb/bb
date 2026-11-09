#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { untestedChangedQueryFunctions } from "./lib/pr-query-functions.mjs";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    artifacts: { type: "string" },
  },
});
if (!values.base || !values.artifacts) {
  console.error(
    "Usage: node scripts/check-pr-query-functions.mjs --base <sha> --artifacts <dir>",
  );
  process.exit(2);
}

const changedFiles = execFileSync(
  "git",
  [
    "diff",
    "--name-only",
    "--diff-filter=AMR",
    "-z",
    values.base,
    "HEAD",
    "--",
    "packages/db/src/data",
  ],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
)
  .split("\0")
  .filter((file) => file.endsWith(".ts"));
if (changedFiles.length === 0) {
  console.log("No query function files changed.");
  process.exit(0);
}

const files = readdirSync(values.artifacts, {
  recursive: true,
  withFileTypes: true,
})
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name));
const listPath = files.find((file) => file.endsWith("query-functions.json"));
if (listPath === undefined) {
  console.error(
    "query-functions.json is missing; the shard that runs @bb/db tests writes it.",
  );
  process.exit(1);
}
const queryFunctions = JSON.parse(readFileSync(listPath, "utf8"));
const executedRows = files
  .filter((file) => file.endsWith(".jsonl"))
  .flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line)),
  );

const untested = untestedChangedQueryFunctions({
  changedFiles,
  queryFunctions,
  executedRows,
});
if (untested.length > 0) {
  console.error(
    `Query functions in files this PR changed that no @bb/db or @bb/server test runs; add a test that runs each one:\n${untested
      .map((name) => `  ${name}`)
      .join("\n")}`,
  );
  process.exit(1);
}
console.log(
  `Every query function in ${changedFiles.length} changed data file(s) runs in a test.`,
);
