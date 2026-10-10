import { describe, expect, it } from "vitest";
import {
  parseBuild,
  releaseState,
  submissionProfile,
} from "./android-beta-common.mjs";

const release = {
  track: "open",
  action: "review",
  versionCode: "9",
  createdAt: new Date().toISOString(),
};

function response(state: string, code = 9, track = "beta") {
  return {
    releases: [
      {
        track,
        activeArtifacts: [{ versionCode: code }],
        releaseLifecycleState: `RELEASE_LIFECYCLE_STATE_${state}`,
      },
    ],
  };
}

describe("Android beta publishing contracts", () => {
  it.each([
    ["open", "draft", "beta", "draft", true],
    ["open", "review", "beta", "completed", false],
    ["internal", "draft", "internal", "draft", true],
    ["internal", "review", "internal", "completed", false],
  ])(
    "maps %s/%s to the intended Play track and review policy",
    (track, action, playTrack, status, holdReview) => {
      expect(submissionProfile({ track, action })).toMatchObject({
        track: playTrack,
        releaseStatus: status,
        changesNotSentForReview: holdReview,
      });
    },
  );

  it("rejects production and unknown actions instead of falling back to a rollout", () => {
    expect(() =>
      submissionProfile({ track: "production", action: "review" }),
    ).toThrow();
    expect(() =>
      submissionProfile({ track: "open", action: "publish" }),
    ).toThrow();
  });

  it("cannot mistake a published older version or another track for this build", () => {
    const value = {
      releases: [
        ...response("PUBLISHED", 8).releases,
        ...response("PUBLISHED", 9, "production").releases,
        ...response("IN_REVIEW").releases,
      ],
    };
    expect(releaseState(value, release)).toMatchObject({
      status: "in_progress",
    });
    expect(releaseState(response("PUBLISHED", 8), release)).toMatchObject({
      status: "in_progress",
    });
  });

  it.each([
    ["DRAFT", "action_required"],
    ["NOT_SENT_FOR_REVIEW", "action_required"],
    ["APPROVED_NOT_PUBLISHED", "action_required"],
    ["NOT_APPROVED", "failure"],
    ["PUBLISHED", "success"],
  ])(
    "reports %s without claiming that upload implies approval",
    (state, conclusion) => {
      expect(releaseState(response(state), release)).toMatchObject({
        status: "completed",
        conclusion,
      });
    },
  );

  it("treats an intentional draft as complete but never treats an unknown state as approval", () => {
    expect(
      releaseState(response("DRAFT"), { ...release, action: "draft" }),
    ).toMatchObject({ conclusion: "neutral" });
    expect(releaseState(response("FUTURE_STATE"), release)).toMatchObject({
      status: "in_progress",
    });
    expect(
      releaseState({}, { ...release, createdAt: "2020-01-01T00:00:00.000Z" }),
    ).toMatchObject({ conclusion: "action_required" });
  });

  it("refuses unfinished, ambiguous, or malformed EAS builds before submission", () => {
    const build = {
      id: "3c7ce4a2-5ba6-46dd-9608-ae444461a5e8",
      platform: "ANDROID",
      status: "FINISHED",
      appIdentifier: "app.getbb.mobile",
      appVersion: "0.39.0",
      appBuildVersion: "9",
      artifacts: { buildUrl: "https://expo.dev/build.aab" },
    };
    expect(parseBuild([build]).id).toBe(build.id);
    expect(() => parseBuild([{ ...build, status: "ERRORED" }])).toThrow();
    expect(() =>
      parseBuild([{ ...build, appIdentifier: "app.other.mobile" }]),
    ).toThrow();
    expect(() => parseBuild([build, build])).toThrow();
    expect(() => parseBuild([{ ...build, appBuildVersion: "" }])).toThrow();
    expect(() =>
      parseBuild([
        { ...build, artifacts: { buildUrl: "http://example.com/build.aab" } },
      ]),
    ).toThrow();
  });
});
