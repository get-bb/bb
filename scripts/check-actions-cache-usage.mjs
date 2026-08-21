#!/usr/bin/env node
// Warns when the repository's GitHub Actions cache is close to its quota.
//
// GitHub gives a repository 10 GB of Actions cache and enforces it by silently
// evicting least-recently-used entries. There is no failure, no warning, and no
// notification: a job that writes an oversized cache just quietly stops getting
// hits, and every other job's cache disappears along with it. That is how the
// macOS smoke leg reached 12.7 GB of Turbo caches while reporting 0 of 8 task
// hits — the symptom was "CI feels slow", which is nobody's alert.
//
// Blacksmith's Linux runners serve `actions/cache` from their own colocated
// store, so those entries never appear here. Anything this reports is running
// on a GitHub-hosted runner and is charged against the quota.

import { appendFileSync } from "node:fs";

const QUOTA_BYTES = 10 * 1024 * 1024 * 1024;
const WARN_FRACTION = 0.7;

function formatGb(bytes) {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function notice(message) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) {
    // Best effort: the summary is a convenience, never the reason to fail.
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
    } catch {
      // Ignore; the console line above is the durable record.
    }
  }
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !token) {
    console.log(
      "Actions cache usage check: GITHUB_REPOSITORY or GITHUB_TOKEN is unset; skipping.",
    );
    return;
  }

  const response = await fetch(
    `${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${repository}/actions/cache/usage`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
    },
  );

  // An unreachable or forbidden API is infrastructure, not a finding. This
  // check exists to surface a slow leak, never to block a merge.
  if (!response.ok) {
    console.log(
      `::warning::Could not read Actions cache usage (HTTP ${response.status}); skipping the quota check.`,
    );
    return;
  }

  const usage = await response.json();
  const used = usage.active_caches_size_in_bytes;
  const fraction = used / QUOTA_BYTES;

  if (fraction < WARN_FRACTION) {
    notice(
      `Actions cache usage: ${formatGb(used)} of ${formatGb(QUOTA_BYTES)} ` +
        `(${Math.round(fraction * 100)}%) across ${usage.active_caches_count} entries.`,
    );
    return;
  }

  notice(
    `::warning::Actions cache usage is ${formatGb(used)} of ${formatGb(QUOTA_BYTES)} ` +
      `(${Math.round(fraction * 100)}%) across ${usage.active_caches_count} entries. ` +
      "GitHub evicts least-recently-used entries without reporting it, so caches " +
      "are about to start missing. Run `gh cache list --limit 100 --json key,sizeInBytes` " +
      "to find the job writing oversized entries; a job on a Blacksmith Linux runner " +
      "should not appear here at all.",
  );
}

await main();
