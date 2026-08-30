import { describe, expect, it } from "vitest";
import { arcThreadSpawnRequest } from "./arc-service.js";
import type { ArcSpawnThreadInput } from "./arcs.js";

const BASE_INPUT: ArcSpawnThreadInput = {
  providerId: "acp-rift",
  arcId: "arc_1",
  projectId: "project_1",
  prompt: "Continue in the Arc",
  title: "Arc task",
};

describe("Arc thread routing", () => {
  it("reuses an explicitly selected environment", () => {
    expect(
      arcThreadSpawnRequest({
        ...BASE_INPUT,
        environmentId: "environment_1",
      }),
    ).toEqual({
      projectId: "project_1",
      providerId: "acp-rift",
      prompt: "Continue in the Arc",
      title: "Arc task",
      executionInputSources: { providerId: "explicit" },
      providerSessionOptions: { arc: { arcId: "arc_1" } },
      environment: { type: "reuse", environmentId: "environment_1" },
    });
  });

  it("routes an explicit host to the invoking absolute cwd", () => {
    expect(
      arcThreadSpawnRequest({
        ...BASE_INPUT,
        hostId: "host_1",
        cwd: "/checkout/project",
      }).environment,
    ).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: { type: "unmanaged", path: "/checkout/project" },
    });
  });

  it("uses project defaults when no explicit route is selected", () => {
    expect(arcThreadSpawnRequest(BASE_INPUT).environment).toEqual({
      type: "project-default",
    });
  });

  it.each([undefined, "", "relative/path", "/unsafe\0path"])(
    "rejects explicit host routing with unsafe or incomplete cwd %s",
    (cwd) => {
      expect(() =>
        arcThreadSpawnRequest({
          ...BASE_INPUT,
          hostId: "host_1",
          ...(cwd === undefined ? {} : { cwd }),
        }),
      ).toThrow(
        "explicit Arc host routing requires a non-empty hostId and an absolute cwd",
      );
    },
  );

  it("rejects conflicting explicit routes", () => {
    expect(() =>
      arcThreadSpawnRequest({
        ...BASE_INPUT,
        hostId: "host_1",
        environmentId: "environment_1",
        cwd: "/checkout/project",
      }),
    ).toThrow("hostId and environmentId are mutually exclusive");
  });
});
