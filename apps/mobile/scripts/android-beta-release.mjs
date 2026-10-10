import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  googleReleases,
  googleToken,
  optionsSchema,
  parseBuild,
  releaseLinks,
  releaseSchema,
  submissionProfile,
  summary,
} from "./android-beta-common.mjs";

async function main() {
  const options = optionsSchema.parse({
    track: process.env.PLAY_TRACK,
    action: process.env.PLAY_ACTION,
  });
  if (!process.env.EXPO_TOKEN) throw new Error("EXPO_TOKEN is required.");
  if (
    process.env.GITHUB_REF !== "refs/heads/main" ||
    process.env.GITHUB_REPOSITORY !== "get-bb/bb"
  ) {
    throw new Error("Run Release Android beta on get-bb/bb main.");
  }
  await googleReleases(await googleToken(), options);
  const eas = (...args) =>
    execFileSync("pnpm", ["exec", "eas", ...args], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    });
  const output = eas(
    "build",
    "--platform",
    "android",
    "--profile",
    "production",
    "--non-interactive",
    "--wait",
    "--json",
  );
  writeFileSync("eas-build.json", output);
  const build = parseBuild(JSON.parse(output));
  const release = releaseSchema.parse({
    ...options,
    buildId: build.id,
    version: build.appVersion,
    versionCode: build.appBuildVersion,
    headSha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    createdAt: new Date().toISOString(),
    artifactUrl: build.artifacts.buildUrl,
    submission: "pending",
  });
  const save = () =>
    writeFileSync(
      "android-beta-release.json",
      `${JSON.stringify(release, null, 2)}\n`,
    );
  save();
  summary(
    `Android ${release.version} (${release.versionCode}) → ${release.track} testing, ${release.action}.\n\n${releaseLinks(release, process.env.GITHUB_REPOSITORY)}`,
  );
  const originalConfig = readFileSync("eas.json", "utf8");
  let wroteKey = false;
  try {
    const config = JSON.parse(originalConfig);
    config.submit["android-beta"] = { android: submissionProfile(options) };
    writeFileSync("eas.json", `${JSON.stringify(config, null, 2)}\n`);
    writeFileSync(
      "google-play-service-account.json",
      process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
      { mode: 0o600, flag: "wx" },
    );
    wroteKey = true;
    execFileSync(
      "pnpm",
      [
        "exec",
        "eas",
        "submit",
        "--platform",
        "android",
        "--profile",
        "android-beta",
        "--id",
        build.id,
        "--non-interactive",
        "--wait",
      ],
      { stdio: "inherit" },
    );
    release.submission = "finished";
    save();
    summary(
      "EAS submission finished. The Android beta review status workflow checks Google's actual review state; submission success does not mean approval.",
    );
  } finally {
    writeFileSync("eas.json", originalConfig);
    if (wroteKey) rmSync("google-play-service-account.json", { force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  summary(
    "Release did not finish. Inspect this run and Play Console before retrying; there is no automatic rebuild, resubmission, or production fallback.",
  );
  process.exitCode = 1;
});
