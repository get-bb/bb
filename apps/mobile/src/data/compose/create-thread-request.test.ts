import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { createThreadRequestSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { buildCreateThreadRequest } from "./create-thread-request";

/** What `useCreateThread` sends: the app request plus the fixed origin fields. */
function parseAsSent(
  request: NonNullable<ReturnType<typeof buildCreateThreadRequest>["request"]>,
) {
  return createThreadRequestSchema.safeParse({
    ...request,
    origin: "app",
    originKind: null,
    startedOnBehalfOf: null,
  });
}

describe("buildCreateThreadRequest", () => {
  it("builds a minimal project-default request that passes the server schema and omits unset optionals", () => {
    const result = buildCreateThreadRequest({
      projectId: "proj_1",
      input: [{ type: "text", text: "hello", mentions: [] }],
      environment: { type: "project-default" },
      providerId: null,
      model: "",
      reasoningLevel: undefined,
      title: "  ",
    });
    expect(result.blocker).toBeNull();
    expect(result.request).toEqual({
      projectId: "proj_1",
      input: [{ type: "text", text: "hello", mentions: [] }],
      environment: { type: "project-default" },
    });
    expect(parseAsSent(result.request!).success).toBe(true);
  });

  it("carries every execution field and files under a section", () => {
    const result = buildCreateThreadRequest({
      projectId: "proj_1",
      input: [{ type: "text", text: "go", mentions: [] }],
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "high",
      permissionMode: "auto",
      serviceTier: "fast",
      sectionId: "sec_1",
      title: "My thread",
      executionInputSources: { model: "client-preference" },
      environment: { type: "reuse", environmentId: "env_1" },
    });
    expect(result.request).toMatchObject({
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "high",
      permissionMode: "auto",
      serviceTier: "fast",
      sectionId: "sec_1",
      title: "My thread",
      executionInputSources: { model: "client-preference" },
      environment: { type: "reuse", environmentId: "env_1" },
    });
    const parsed = parseAsSent(result.request!);
    expect(parsed.success).toBe(true);
  });

  it("reports blockers instead of building an invalid request", () => {
    expect(
      buildCreateThreadRequest({
        projectId: "proj_1",
        input: [{ type: "text", text: "   ", mentions: [] }],
        environment: { type: "project-default" },
      }),
    ).toEqual({ request: null, blocker: "empty-prompt" });
    expect(
      buildCreateThreadRequest({
        projectId: "",
        input: [{ type: "text", text: "x", mentions: [] }],
        environment: { type: "project-default" },
      }),
    ).toEqual({ request: null, blocker: "missing-project" });
    expect(
      buildCreateThreadRequest({
        projectId: "proj_1",
        input: [{ type: "text", text: "x", mentions: [] }],
        environment: { type: "reuse", environmentId: null },
      }),
    ).toEqual({ request: null, blocker: "reuse-environment-required" });
  });

  it("maps host selections: personal project → personal workspace; managed worktree base branch; unmanaged branch intents", () => {
    const personal = buildCreateThreadRequest({
      projectId: PERSONAL_PROJECT_ID,
      input: [{ type: "text", text: "x", mentions: [] }],
      environment: {
        type: "host",
        hostId: "host_1",
        workspace: { type: "managed-worktree", baseBranch: "main" },
      },
    });
    expect(personal.request?.environment).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: { type: "personal" },
    });
    expect(parseAsSent(personal.request!).success).toBe(true);

    const worktreeDefault = buildCreateThreadRequest({
      projectId: "proj_1",
      input: [{ type: "text", text: "x", mentions: [] }],
      defaultBranch: "main",
      defaultWorktreeBaseBranch: "main",
      environment: {
        type: "host",
        hostId: "host_1",
        workspace: { type: "managed-worktree", baseBranch: null },
      },
    });
    expect(worktreeDefault.request?.environment).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
    });
    const worktreeConfigured = buildCreateThreadRequest({
      projectId: "proj_1",
      input: [{ type: "text", text: "x", mentions: [] }],
      defaultBranch: "main",
      defaultWorktreeBaseBranch: "develop",
      environment: {
        type: "host",
        hostId: "host_1",
        workspace: { type: "managed-worktree", baseBranch: null },
      },
    });
    expect(worktreeConfigured.request?.environment).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "named", name: "develop" },
      },
    });
    const worktreePicked = buildCreateThreadRequest({
      projectId: "proj_1",
      input: [{ type: "text", text: "x", mentions: [] }],
      environment: {
        type: "host",
        hostId: "host_1",
        workspace: { type: "managed-worktree", baseBranch: "feature/x" },
      },
    });
    expect(worktreePicked.request?.environment).toMatchObject({
      workspace: { baseBranch: { kind: "named", name: "feature/x" } },
    });
    expect(parseAsSent(worktreePicked.request!).success).toBe(true);

    const unmanagedNew = buildCreateThreadRequest({
      projectId: "proj_1",
      input: [{ type: "text", text: "x", mentions: [] }],
      environment: {
        type: "host",
        hostId: "host_1",
        workspace: {
          type: "unmanaged",
          path: null,
          branch: { name: "main", isNew: true },
        },
      },
    });
    expect(unmanagedNew.request?.environment).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: {
        type: "unmanaged",
        path: null,
        branch: { kind: "new", baseBranch: "main" },
      },
    });
    expect(parseAsSent(unmanagedNew.request!).success).toBe(true);
    const unmanagedExisting = buildCreateThreadRequest({
      projectId: "proj_1",
      input: [{ type: "text", text: "x", mentions: [] }],
      environment: {
        type: "host",
        hostId: "host_1",
        workspace: {
          type: "unmanaged",
          path: "/repo",
          branch: { name: "fix", isNew: false },
        },
      },
    });
    expect(unmanagedExisting.request?.environment).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: {
        type: "unmanaged",
        path: "/repo",
        branch: { kind: "existing", name: "fix" },
      },
    });
    const unmanagedPlain = buildCreateThreadRequest({
      projectId: "proj_1",
      input: [{ type: "text", text: "x", mentions: [] }],
      environment: {
        type: "host",
        hostId: "host_1",
        workspace: { type: "unmanaged", path: null, branch: null },
      },
    });
    expect(unmanagedPlain.request?.environment).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: { type: "unmanaged", path: null },
    });
    expect(parseAsSent(unmanagedPlain.request!).success).toBe(true);
  });
});
