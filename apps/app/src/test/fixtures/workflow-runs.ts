import type { WorkflowRunResponse } from "@bb/server-contract";

export function makeWorkflowRunResponse(
  overrides: Partial<WorkflowRunResponse> = {},
): WorkflowRunResponse {
  return {
    id: "wfr_test01",
    projectId: "proj_test",
    hostId: "host_test",
    workspacePath: "/Users/dev/checkouts/acme",
    anchorThreadId: null,
    workflowName: "deep-research",
    sourceTier: "project",
    scriptHash: "3f9c2a71b4d8e605",
    argsJson: null,
    seed: 424242,
    keyVersion: "bb1",
    providerId: "claude-code",
    model: null,
    effort: "medium",
    sandbox: "read-only",
    concurrency: 8,
    maxAgents: 30,
    maxFanout: 10,
    budgetOutputTokens: null,
    status: "running",
    failureReason: null,
    progressSnapshot: null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      toolUses: 0,
      durationMs: 0,
    },
    resultJson: null,
    retention: "live",
    createdAt: 1,
    startedAt: null,
    settledAt: null,
    updatedAt: 1,
    ...overrides,
  };
}
