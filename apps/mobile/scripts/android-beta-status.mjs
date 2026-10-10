import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  googleReleases,
  googleToken,
  releaseLinks,
  releaseSchema,
  releaseState,
  summary,
} from "./android-beta-common.mjs";

const repo = "get-bb/bb";
const gh = (...args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["pipe", "pipe", "inherit"],
  });
const runSchema = z.object({
  id: z.number().int().positive(),
  head_sha: z.string(),
  head_branch: z.literal("main"),
  path: z.literal(".github/workflows/mobile-android-beta.yml"),
  status: z.literal("completed"),
  event: z.literal("workflow_dispatch"),
  created_at: z.iso.datetime(),
});

async function main() {
  const runId = process.env.PLAY_RELEASE_RUN_ID || "";
  if (runId && !/^[1-9]\d*$/u.test(runId))
    throw new Error("Release run ID must be numeric.");
  const runs = runId
    ? [
        runSchema.parse(
          JSON.parse(gh("api", `repos/${repo}/actions/runs/${runId}`)),
        ),
      ]
    : z
        .object({ workflow_runs: z.array(runSchema) })
        .parse(
          JSON.parse(
            gh(
              "api",
              `repos/${repo}/actions/workflows/mobile-android-beta.yml/runs?branch=main&status=completed&event=workflow_dispatch&per_page=100`,
            ),
          ),
        ).workflow_runs;
  let token;
  const tracks = new Map();
  let requiresAction = false;
  let checked = 0;
  for (const run of runs) {
    if (
      !runId &&
      Date.now() - Date.parse(run.created_at) > 90 * 24 * 60 * 60 * 1000
    )
      continue;
    const artifacts = z
      .object({
        artifacts: z.array(
          z.object({ name: z.string(), expired: z.boolean() }),
        ),
      })
      .parse(
        JSON.parse(gh("api", `repos/${repo}/actions/runs/${run.id}/artifacts`)),
      );
    if (
      !artifacts.artifacts.some(
        (artifact) =>
          artifact.name === "android-beta-release" && !artifact.expired,
      )
    ) {
      if (runId)
        summary(
          `Run ${run.id} has no retained Android beta release artifact. Check its build logs.`,
        );
      continue;
    }
    const directory = mkdtempSync(join(tmpdir(), "bb-play-release-"));
    let release;
    try {
      gh(
        "run",
        "download",
        String(run.id),
        "--repo",
        repo,
        "--name",
        "android-beta-release",
        "--dir",
        directory,
      );
      release = releaseSchema.parse(
        JSON.parse(
          readFileSync(join(directory, "android-beta-release.json"), "utf8"),
        ),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    if (release.headSha !== run.head_sha || release.runId !== String(run.id)) {
      throw new Error(`Release metadata does not match run ${run.id}.`);
    }
    const name = `Google Play ${release.track} testing (${release.versionCode})`;
    const existing = z
      .object({
        check_runs: z.array(
          z.object({
            id: z.number().int(),
            external_id: z.string().nullable(),
            status: z.string(),
            output: z.object({ title: z.string().nullable() }),
          }),
        ),
      })
      .parse(
        JSON.parse(
          gh(
            "api",
            `repos/${repo}/commits/${run.head_sha}/check-runs?check_name=${encodeURIComponent(name)}&filter=all&per_page=100`,
          ),
        ),
      )
      .check_runs.find((check) => check.external_id === String(run.id));
    if (existing?.status === "completed" && !runId) continue;
    token ??= await googleToken();
    if (!tracks.has(release.track))
      tracks.set(release.track, await googleReleases(token, release));
    const state = releaseState(tracks.get(release.track), release);
    const details = `${release.version} (${release.versionCode}) — ${release.track} testing: **${state.title}**.\n\n${releaseLinks(release, repo)}${release.submission === "pending" ? "\n\nEAS submission did not report success. Inspect the release workflow before any retry." : ""}`;
    summary(details);
    checked++;
    if (
      existing?.output.title === state.title &&
      existing.status === state.status
    )
      continue;
    const payload = {
      name,
      external_id: String(run.id),
      status: state.status,
      ...(state.conclusion
        ? {
            conclusion: state.conclusion,
            completed_at: new Date().toISOString(),
          }
        : {}),
      details_url: `https://github.com/${repo}/actions/runs/${run.id}`,
      output: { title: state.title, summary: details },
      ...(!existing ? { head_sha: run.head_sha } : {}),
    };
    execFileSync(
      "gh",
      [
        "api",
        "--method",
        existing ? "PATCH" : "POST",
        `repos/${repo}/check-runs${existing ? `/${existing.id}` : ""}`,
        "--input",
        "-",
      ],
      {
        input: JSON.stringify(payload),
        encoding: "utf8",
        stdio: ["pipe", "ignore", "inherit"],
      },
    );
    requiresAction ||=
      state.conclusion === "failure" || state.conclusion === "action_required";
  }
  if (checked === 0)
    summary(
      "No Android beta releases need a status update. Terminal checks are retained on the release commit; supply a run ID to recheck one.",
    );
  if (requiresAction) {
    console.error(
      "Google Play needs attention. See this run's summary and the release commit's Google Play check.",
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
