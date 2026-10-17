import { createSign } from "node:crypto";
import { appendFileSync } from "node:fs";
import { z } from "zod";

export const packageName = "app.getbb.mobile";
export const consoleUrl =
  "https://play.google.com/console/u/0/developers/7623076799572608180/app/4972737194109128393/publishing";

const httpsUrl = z
  .url()
  .refine((value) => new URL(value).protocol === "https:");
const versionCode = z.string().regex(/^[1-9]\d*$/u);
export const optionsSchema = z.object({
  track: z.enum(["open", "internal"]),
  action: z.enum(["draft", "review"]),
});
export const releaseSchema = optionsSchema.extend({
  buildId: z.uuid(),
  version: z.string().min(1),
  versionCode,
  headSha: z.string().regex(/^[a-f0-9]{40}$/u),
  runId: z.string().regex(/^[1-9]\d*$/u),
  createdAt: z.iso.datetime(),
  artifactUrl: httpsUrl,
  submission: z.enum(["pending", "finished"]),
});

export function parseBuild(value) {
  const builds = z
    .array(
      z.object({
        id: z.uuid(),
        platform: z.literal("ANDROID"),
        status: z.literal("FINISHED"),
        appIdentifier: z.literal(packageName),
        appVersion: z.string().min(1),
        appBuildVersion: versionCode,
        artifacts: z.object({ buildUrl: httpsUrl }),
      }),
    )
    .length(1)
    .parse(value);
  return builds[0];
}

export function submissionProfile(options) {
  const { track, action } = optionsSchema.parse(options);
  return {
    serviceAccountKeyPath: "./google-play-service-account.json",
    track: track === "open" ? "beta" : "internal",
    releaseStatus: action === "draft" ? "draft" : "completed",
    changesNotSentForReview: action === "draft",
  };
}

export function releaseState(value, release) {
  const response = z
    .object({
      releases: z
        .array(
          z.object({
            track: z.string(),
            activeArtifacts: z
              .array(z.object({ versionCode: z.number().int().positive() }))
              .default([]),
            releaseLifecycleState: z.string(),
          }),
        )
        .default([]),
    })
    .parse(value);
  const match = response.releases.find(
    (entry) =>
      entry.track === submissionProfile(release).track &&
      entry.activeArtifacts.some(
        (artifact) => String(artifact.versionCode) === release.versionCode,
      ),
  );
  const state = match?.releaseLifecycleState;
  switch (state) {
    case "RELEASE_LIFECYCLE_STATE_DRAFT":
      return release.action === "draft"
        ? { title: "Draft saved", status: "completed", conclusion: "neutral" }
        : {
            title: "Still a draft; send for review in Play Console",
            status: "completed",
            conclusion: "action_required",
          };
    case "RELEASE_LIFECYCLE_STATE_NOT_SENT_FOR_REVIEW":
      return {
        title: "Send for review in Play Console",
        status: "completed",
        conclusion: "action_required",
      };
    case "RELEASE_LIFECYCLE_STATE_IN_REVIEW":
      return { title: "In review", status: "in_progress" };
    case "RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED":
      return {
        title: "Approved; publish in Play Console",
        status: "completed",
        conclusion: "action_required",
      };
    case "RELEASE_LIFECYCLE_STATE_NOT_APPROVED":
      return {
        title: "Rejected; inspect the policy finding in Play Console",
        status: "completed",
        conclusion: "failure",
      };
    case "RELEASE_LIFECYCLE_STATE_PUBLISHED":
      return {
        title:
          "Published on the testing track (check Console for rollout coverage)",
        status: "completed",
        conclusion: "success",
      };
    default:
      if (Date.now() - Date.parse(release.createdAt) > 24 * 60 * 60 * 1000) {
        return {
          title:
            "Release state unavailable after 24 hours; inspect Play Console",
          status: "completed",
          conclusion: "action_required",
        };
      }
      return {
        title: "Waiting for Google Play release status",
        status: "in_progress",
      };
  }
}

export function summary(text) {
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n\n`);
  }
}

export function releaseLinks(release, repo) {
  return `[Expo build](https://expo.dev/accounts/bb-team/projects/bb-app/builds/${release.buildId}) · [Download AAB](${release.artifactUrl}) · [Release workflow](https://github.com/${repo}/actions/runs/${release.runId}) · [Play Console](${consoleUrl})`;
}

export async function googleToken() {
  let value;
  try {
    value = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || "null");
  } catch {
    throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  const parsed = z
    .object({
      type: z.literal("service_account"),
      client_email: z.email(),
      private_key: z.string().min(1),
    })
    .safeParse(value);
  if (!parsed.success) {
    throw new Error(
      "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON must contain a Google service-account key.",
    );
  }
  const key = parsed.data;
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256")
    .update(input)
    .sign(key.private_key, "base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${input}.${signature}`,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `Google token exchange failed (${response.status}); check the service-account key.`,
    );
  const { access_token: token } = z
    .object({ access_token: z.string().min(1) })
    .parse(await response.json());
  return token;
}

export async function googleReleases(token, options) {
  const track = submissionProfile(options).track;
  const response = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/tracks/${track}/releases`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Google Play release lookup failed (${response.status}); enable the Android Publisher API and grant this account access to ${packageName}.`,
    );
  return response.json();
}
