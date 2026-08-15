import { describe, expect, it } from "vitest";
import { DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG } from "@bb/domain";
import type { ProviderExecutionContext } from "../provider-adapter.js";
import {
  buildClaudeCanonicalSessionParams,
  buildClaudeCanonicalTurnParams,
  buildClaudeSessionParams,
} from "./session-params.js";

/**
 * Both dialects must feed the same internal session-construction machinery:
 * the canonical wire (execution options plus the claude-flavored knobs the
 * generic bridge-protocol adapter packs under `options.providerOptions`)
 * has to produce exactly the params the legacy adapter builds from the same
 * `ProviderExecutionContext`. Divergence here is the migration hazard — a
 * knob that silently stops reaching the bridge on one dialect.
 */

const EXECUTION_CONTEXT = {
  model: "claude-sonnet-5",
  reasoningLevel: "high",
  claudeCodePermissionMode: "plan",
  claudeCodeMockCliTraffic: { enabled: true, endpoint: "http://127.0.0.1:1" },
  workflowsEnabled: true,
  memoryEnabled: false,
  providerSubagentsEnabled: false,
  instructions: "Session instructions",
  envVars: { BB_TEST: "1" },
  permissionMode: "accept-edits",
  permissionScope: "workspace",
  approvalReviewer: "user",
  permissionEscalation: "ask",
} satisfies ProviderExecutionContext;

/**
 * The canonical wire options exactly as the generic adapter's
 * `toBridgeWireOptions` packs them: core execution fields top-level, every
 * claude-flavored knob in the opaque providerOptions bag — and nothing
 * claude-flavored at top level, so the test fails if the bridge mapping ever
 * reads a knob from the wrong placement.
 */
function toCanonicalWireOptions(options: typeof EXECUTION_CONTEXT) {
  const {
    claudeCodePermissionMode,
    claudeCodeMockCliTraffic,
    workflowsEnabled,
    memoryEnabled,
    providerSubagentsEnabled,
    ...core
  } = options;
  return {
    ...core,
    providerOptions: {
      claudeCodePermissionMode,
      claudeCodeMockCliTraffic,
      workflowsEnabled,
      memoryEnabled,
      providerSubagentsEnabled,
    },
  };
}

describe("buildClaudeCanonicalSessionParams", () => {
  it("produces exactly the legacy adapter's session params for the same execution context", () => {
    const shared = {
      threadId: "thread-1",
      cwd: "/tmp/worktree",
      instructionMode: "append" as const,
      dynamicTools: [
        { name: "tool", description: "desc", inputSchema: { type: "object" } },
      ],
      disallowedTools: ["WebSearch"],
    };
    expect(
      buildClaudeCanonicalSessionParams({
        ...shared,
        options: toCanonicalWireOptions(EXECUTION_CONTEXT),
      }),
    ).toEqual(
      buildClaudeSessionParams({
        ...shared,
        additionalWorkspaceWriteRoots: [],
        options: EXECUTION_CONTEXT,
      }),
    );
  });

  it("falls back to provider defaults when the providerOptions bag is absent", () => {
    const params = buildClaudeCanonicalSessionParams({
      threadId: "thread-1",
      cwd: "/tmp/worktree",
      instructionMode: "append",
      options: {
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
    });
    expect(params).toMatchObject({
      workflowsEnabled: false,
      claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
      permissionMode: "bypassPermissions",
      approvedPlanPermissionMode: "bypassPermissions",
    });
  });
});

describe("buildClaudeCanonicalTurnParams", () => {
  it("leaves live-setting knobs undefined when providerOptions omits them, so the session keeps its current values", () => {
    const params = buildClaudeCanonicalTurnParams({
      threadId: "thread-1",
      providerThreadId: "provider-1",
      input: [{ type: "text", text: "hi" }],
      options: {
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
    });
    expect(params.workflowsEnabled).toBeUndefined();
    expect(params.memoryEnabled).toBeUndefined();
    expect(params.providerSubagentsEnabled).toBeUndefined();
    expect(params.permissionEscalation).toBeNull();
  });
});
