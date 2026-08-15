import { describe, expect, it } from "vitest";
import { DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG } from "@bb/domain";
import type { RuntimePermissionPolicy } from "@bb/domain";
import {
  buildClaudeCanonicalSessionParams,
  buildClaudeCanonicalTurnParams,
  buildClaudeSessionParams,
  type ClaudeSessionExecutionOptions,
} from "./session-params.js";

/**
 * Both dialects must feed the same internal session-construction machinery:
 * the canonical wire (execution options plus the claude-flavored knobs the
 * generic bridge-protocol adapter packs under `options.providerOptions`)
 * has to produce exactly the params the legacy adapter builds from the same
 * `ProviderExecutionContext`, which satisfies it structurally. Divergence here is the migration hazard — a
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
} satisfies ClaudeSessionExecutionOptions;

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

const WORKSPACE_ACCEPT_EDITS_POLICY = {
  permissionMode: "accept-edits",
  permissionScope: "workspace",
  approvalReviewer: "user",
  permissionEscalation: "deny",
} satisfies RuntimePermissionPolicy;

const WORKSPACE_AUTO_POLICY = {
  permissionMode: "auto",
  permissionScope: "workspace",
  approvalReviewer: "automatic",
  permissionEscalation: "ask",
} satisfies RuntimePermissionPolicy;

const FULL_POLICY = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} satisfies RuntimePermissionPolicy;

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
    const canonical = buildClaudeCanonicalSessionParams({
      ...shared,
      options: toCanonicalWireOptions(EXECUTION_CONTEXT),
    });

    expect(canonical).toEqual(
      buildClaudeSessionParams({
        ...shared,
        additionalWorkspaceWriteRoots: [],
        options: EXECUTION_CONTEXT,
      }),
    );
    // Absolute anchors, so the case still pins real mappings rather than only
    // comparing two functions that share an implementation: native plan mode
    // is a session option (`claudeCodePermissionMode: "plan"` becomes the SDK
    // permission mode), and an explicit workflow toggle stays explicit.
    expect(canonical.permissionMode).toBe("plan");
    expect(canonical.workflowsEnabled).toBe(true);
  });

  // The daemon's environment-level extra write roots have no core canonical
  // field; they ride the providerOptions bag. Losing them silently narrows a
  // canonical workspace-scope session to cwd alone.
  it("passes the daemon's extra workspace write roots from the providerOptions bag", () => {
    const shared = {
      threadId: "thread-1",
      cwd: "/tmp/worktree",
      instructionMode: "append" as const,
    };
    const additionalWorkspaceWriteRoots = ["/tmp/thread-storage"];
    const canonical = buildClaudeCanonicalSessionParams({
      ...shared,
      options: {
        ...toCanonicalWireOptions(EXECUTION_CONTEXT),
        providerOptions: {
          ...toCanonicalWireOptions(EXECUTION_CONTEXT).providerOptions,
          additionalWorkspaceWriteRoots,
        },
      },
    });

    expect(canonical.additionalWorkspaceWriteRoots).toEqual(
      additionalWorkspaceWriteRoots,
    );
    expect(canonical).toEqual(
      buildClaudeSessionParams({
        ...shared,
        additionalWorkspaceWriteRoots,
        options: EXECUTION_CONTEXT,
      }),
    );
  });

  it("falls back to provider defaults when the providerOptions bag is absent", () => {
    const params = buildClaudeCanonicalSessionParams({
      threadId: "thread-1",
      cwd: "/tmp/worktree",
      instructionMode: "append",
      options: FULL_POLICY,
    });
    expect(params).toMatchObject({
      workflowsEnabled: false,
      claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
      permissionMode: "bypassPermissions",
      approvedPlanPermissionMode: "bypassPermissions",
    });

    // An explicit false stays explicit: omission is not a hidden default, so
    // both explicit values have to survive the mapping unchanged.
    expect(
      buildClaudeCanonicalSessionParams({
        threadId: "thread-1",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        options: {
          ...FULL_POLICY,
          providerOptions: { workflowsEnabled: false },
        },
      }).workflowsEnabled,
    ).toBe(false);
    expect(
      buildClaudeCanonicalSessionParams({
        threadId: "thread-1",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        options: {
          ...FULL_POLICY,
          providerOptions: { workflowsEnabled: true },
        },
      }).workflowsEnabled,
    ).toBe(true);
  });
});

/**
 * Session-parameter invariants moved here from the retired claude-code legacy
 * adapter suite. Each was asserted there through
 * `adapter.buildCommandPlan({ type: "thread/start" | "thread/resume" })` on
 * `plan.params`, and those params ARE this module's output, so the assertions
 * carry over unchanged. The start/resume twins are collapsed into single
 * cases: the legacy adapter's only resume-side difference was merging
 * `providerThreadId` onto the same params, which is adapter shaping that dies
 * with the adapter. Where the invariant is about what actually reaches the
 * bridge, the canonical builder is the assertion target.
 */

const EXTRA_WORKSPACE_WRITE_ROOTS = [
  "/repo/.git/worktrees/bb13",
  "/repo/.git/objects",
];

/**
 * The daemon's construction-level extra write roots as the registry packs
 * them onto the canonical wire: inside the opaque providerOptions bag.
 */
function toWireOptionsWithRoots(args: {
  policy: RuntimePermissionPolicy;
  additionalWorkspaceWriteRoots: string[];
}) {
  return {
    ...args.policy,
    providerOptions: {
      workflowsEnabled: false,
      additionalWorkspaceWriteRoots: args.additionalWorkspaceWriteRoots,
    },
  };
}

describe("claude session workspace-write roots", () => {
  it("includes construction-level workspace-write roots", () => {
    const params = buildClaudeCanonicalSessionParams({
      threadId: "bb-thread-1",
      cwd: "/tmp/worktree",
      instructionMode: "append",
      options: toWireOptionsWithRoots({
        policy: WORKSPACE_ACCEPT_EDITS_POLICY,
        additionalWorkspaceWriteRoots: EXTRA_WORKSPACE_WRITE_ROOTS,
      }),
    });

    expect(params).toMatchObject({
      additionalWorkspaceWriteRoots: EXTRA_WORKSPACE_WRITE_ROOTS,
    });
  });

  // The key must be absent, not an empty array: the bridge treats a present
  // key as an explicit root list.
  it("omits empty workspace-write roots", () => {
    expect(
      buildClaudeCanonicalSessionParams({
        threadId: "bb-thread-1",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        options: toWireOptionsWithRoots({
          policy: WORKSPACE_ACCEPT_EDITS_POLICY,
          additionalWorkspaceWriteRoots: [],
        }),
      }),
    ).not.toHaveProperty("additionalWorkspaceWriteRoots");

    expect(
      buildClaudeSessionParams({
        threadId: "bb-thread-1",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        additionalWorkspaceWriteRoots: [],
        options: {
          ...WORKSPACE_ACCEPT_EDITS_POLICY,
          claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
          workflowsEnabled: false,
        },
      }),
    ).not.toHaveProperty("additionalWorkspaceWriteRoots");
  });

  // The roots are gated on the permission SCOPE, not the permission mode: an
  // auto-approving workspace session still needs them, and a full-access
  // session must not carry a narrowing root list at all.
  it("shares workspace roots with auto but omits them for full", () => {
    const shared = {
      cwd: "/tmp/worktree",
      instructionMode: "append" as const,
    };
    const autoParams = buildClaudeCanonicalSessionParams({
      ...shared,
      threadId: "bb-thread-readonly",
      options: toWireOptionsWithRoots({
        policy: WORKSPACE_AUTO_POLICY,
        additionalWorkspaceWriteRoots: EXTRA_WORKSPACE_WRITE_ROOTS,
      }),
    });
    const fullParams = buildClaudeCanonicalSessionParams({
      ...shared,
      threadId: "bb-thread-full",
      options: toWireOptionsWithRoots({
        policy: FULL_POLICY,
        additionalWorkspaceWriteRoots: EXTRA_WORKSPACE_WRITE_ROOTS,
      }),
    });

    expect(autoParams).toMatchObject({
      permissionMode: "auto",
      additionalWorkspaceWriteRoots: EXTRA_WORKSPACE_WRITE_ROOTS,
    });
    expect(fullParams).not.toHaveProperty("additionalWorkspaceWriteRoots");
  });
});

describe("claude session option passthrough", () => {
  it("passes through model, env vars, instructions, max reasoning level, and dynamic tools", () => {
    const params = buildClaudeSessionParams({
      threadId: "bb-thread-1",
      cwd: "/tmp/worktree",
      instructionMode: "append",
      additionalWorkspaceWriteRoots: [],
      options: {
        ...WORKSPACE_ACCEPT_EDITS_POLICY,
        permissionEscalation: "ask",
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        workflowsEnabled: false,
        model: "claude-opus-4-7",
        instructions: "Focus on the failing tests first.",
        reasoningLevel: "max",
        envVars: {
          "BAD.KEY": "ignored",
          TEST_VAR: "123",
        },
      },
      dynamicTools: [
        {
          name: "bb_test_ping",
          description: "Ping the host",
          inputSchema: {
            type: "object",
            properties: {
              ping: { type: "boolean" },
            },
            required: ["ping"],
          },
        },
      ],
      disallowedTools: ["ExitPlanMode", "NotebookEdit", "Task"],
    });

    expect(params).toMatchObject({
      threadId: "bb-thread-1",
      model: "claude-opus-4-7",
      reasoningLevel: "max",
      permissionMode: "acceptEdits",
      permissionEscalation: "ask",
      baseInstructions: expect.stringContaining(
        "Focus on the failing tests first.",
      ),
      dynamicTools: [
        {
          name: "bb_test_ping",
          description: "Ping the host",
          inputSchema: {
            type: "object",
            properties: {
              ping: { type: "boolean" },
            },
            required: ["ping"],
          },
        },
      ],
      disallowedTools: ["ExitPlanMode", "NotebookEdit", "Task"],
    });
    expect(params).toMatchObject({
      config: {
        "shell_environment_policy.set.TEST_VAR": "123",
      },
    });
    // A dotted name cannot be expressed as a shell-environment-policy key, so
    // it is dropped rather than smuggled into the config as a nested path.
    expect(params).not.toMatchObject({
      config: {
        "shell_environment_policy.set.BAD.KEY": "ignored",
      },
    });
  });

  it("maps automatic review to Claude auto", () => {
    const params = buildClaudeSessionParams({
      threadId: "bb-thread-1",
      cwd: "/tmp/worktree",
      instructionMode: "append",
      additionalWorkspaceWriteRoots: [],
      options: {
        ...WORKSPACE_AUTO_POLICY,
        permissionEscalation: "deny",
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        workflowsEnabled: false,
      },
    });

    expect(params).toMatchObject({
      permissionMode: "auto",
      permissionEscalation: "deny",
    });
  });

  it("ignores escalation in full permission mode", () => {
    const params = buildClaudeSessionParams({
      threadId: "bb-thread-1",
      cwd: "/tmp/worktree",
      instructionMode: "append",
      additionalWorkspaceWriteRoots: [],
      options: {
        ...FULL_POLICY,
        claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
        workflowsEnabled: false,
      },
    });

    expect(params).toMatchObject({
      permissionMode: "bypassPermissions",
      permissionEscalation: null,
    });
  });
});

describe("buildClaudeCanonicalTurnParams", () => {
  it("leaves live-setting knobs undefined when providerOptions omits them, so the session keeps its current values", () => {
    const params = buildClaudeCanonicalTurnParams({
      threadId: "thread-1",
      providerThreadId: "provider-1",
      input: [{ type: "text", text: "hi", mentions: [] }],
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

  // Plan mode rides the session options; a literal "/plan" left in the prompt
  // would reach the CLI as a second, redundant command. The legacy adapter
  // strips it, so the canonical path must too.
  it("strips the /plan command mention that opened plan mode", () => {
    const params = buildClaudeCanonicalTurnParams({
      threadId: "thread-1",
      providerThreadId: "provider-1",
      input: [
        {
          type: "text",
          text: "/plan inspect the failing test",
          mentions: [
            {
              start: 0,
              end: 5,
              resource: {
                kind: "command",
                trigger: "/",
                name: "plan",
                source: "command",
                origin: "user",
                label: "plan",
                argumentHint: null,
              },
            },
          ],
        },
      ],
      options: {
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
        providerOptions: { claudeCodePermissionMode: "plan" },
      },
    });

    expect(params.input).toEqual([
      { type: "text", text: "inspect the failing test", mentions: [] },
    ]);
  });
});
