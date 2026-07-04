import { describe, expect, it } from "vitest";
import type { ProjectRunCommandTargetState } from "@bb/server-contract";
import {
  getRunCommandStateForTarget,
  isRunCommandStateActive,
  runCommandTargetKey,
} from "./project-run-command";

const projectState: ProjectRunCommandTargetState = {
  target: { kind: "project" },
  status: "running",
  terminalSessionId: "term_project",
  terminalTarget: { kind: "host_path", hostId: "host", cwd: "/repo" },
  updatedAt: 1,
};

const environmentState: ProjectRunCommandTargetState = {
  target: { kind: "environment", environmentId: "env_a" },
  status: "exited",
  terminalSessionId: "term_env",
  terminalTarget: { kind: "environment", environmentId: "env_a" },
  updatedAt: 2,
};

describe("runCommandTargetKey", () => {
  it("distinguishes project and environment targets", () => {
    expect(runCommandTargetKey({ kind: "project" })).toBe("project");
    expect(
      runCommandTargetKey({ kind: "environment", environmentId: "env_a" }),
    ).toBe("environment:env_a");
  });
});

describe("getRunCommandStateForTarget", () => {
  const states = [projectState, environmentState];

  it("matches the environment state by environment id", () => {
    expect(
      getRunCommandStateForTarget(states, {
        kind: "environment",
        environmentId: "env_a",
      }),
    ).toBe(environmentState);
  });

  it("matches the project state", () => {
    expect(getRunCommandStateForTarget(states, { kind: "project" })).toBe(
      projectState,
    );
  });

  it("returns undefined for an unmatched environment", () => {
    expect(
      getRunCommandStateForTarget(states, {
        kind: "environment",
        environmentId: "env_missing",
      }),
    ).toBeUndefined();
  });
});

describe("isRunCommandStateActive", () => {
  it("is true for a running session and false for exited or absent", () => {
    expect(isRunCommandStateActive(projectState)).toBe(true);
    expect(isRunCommandStateActive(environmentState)).toBe(false);
    expect(isRunCommandStateActive(undefined)).toBe(false);
  });
});
