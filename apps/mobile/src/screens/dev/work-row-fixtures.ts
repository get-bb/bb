import type { WorkflowProgressSnapshot } from "@bb/domain";
import type {
  TimelineApprovalWorkRow,
  TimelineCommandWorkRow,
  TimelineConversationRow,
  TimelineDelegationWorkRow,
  TimelineFileChangeWorkRow,
  TimelineImageViewWorkRow,
  TimelineQuestionWorkRow,
  TimelineRow,
  TimelineToolWorkRow,
  TimelineWebFetchWorkRow,
  TimelineWebSearchWorkRow,
  TimelineWorkflowWorkRow,
} from "@bb/server-contract";

/**
 * Synthetic `TimelineRow[]` covering every work kind (and the shapes the
 * fake e2e provider cannot produce: file changes, delegations with children,
 * workflows, web rows, image views) for the `/dev/work-rows` showcase.
 */

const ESC = "\u001b";
const T0 = Date.parse("2026-08-19T10:00:00Z");
let seq = 0;

function base(id: string, offsetMs: number, durationMs: number | null) {
  seq += 1;
  return {
    id,
    threadId: "dev-thread",
    turnId: "turn-1",
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    startedAt: T0 + offsetMs,
    createdAt: T0 + offsetMs + (durationMs ?? 0),
  };
}

function user(id: string, text: string): TimelineConversationRow {
  return {
    ...base(id, 0, 0),
    kind: "conversation",
    role: "user",
    text,
    attachments: null,
    initiator: "user",
    senderThreadId: null,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    turnRequest: { isGrouped: false, kind: "message", status: "accepted" },
    mentions: [],
  };
}

function assistant(id: string, text: string): TimelineConversationRow {
  return {
    ...base(id, 1_000, 0),
    kind: "conversation",
    role: "assistant",
    text,
    attachments: null,
    turnRequest: null,
  };
}

function command(
  id: string,
  overrides: Partial<TimelineCommandWorkRow> &
    Pick<TimelineCommandWorkRow, "command">,
  durationMs: number | null = 1_200,
): TimelineCommandWorkRow {
  const row = base(id, 2_000, durationMs);
  return {
    ...row,
    kind: "work",
    workKind: "command",
    status: durationMs === null ? "pending" : "completed",
    callId: `call-${id}`,
    cwd: "/Users/dev/repo",
    source: null,
    output: "",
    exitCode: durationMs === null ? null : 0,
    completedAt: durationMs === null ? null : row.startedAt + durationMs,
    approvalStatus: null,
    activityIntents: [],
    ...overrides,
  };
}

function tool(
  id: string,
  overrides: Partial<TimelineToolWorkRow> &
    Pick<TimelineToolWorkRow, "toolName">,
  durationMs: number | null = 800,
): TimelineToolWorkRow {
  const row = base(id, 3_000, durationMs);
  return {
    ...row,
    kind: "work",
    workKind: "tool",
    status: durationMs === null ? "pending" : "completed",
    callId: `call-${id}`,
    toolArgs: null,
    output: "",
    completedAt: durationMs === null ? null : row.startedAt + durationMs,
    approvalStatus: null,
    activityIntents: [],
    ...overrides,
  };
}

function fileChange(
  id: string,
  overrides: Partial<TimelineFileChangeWorkRow> &
    Pick<TimelineFileChangeWorkRow, "change">,
): TimelineFileChangeWorkRow {
  return {
    ...base(id, 4_000, 300),
    kind: "work",
    workKind: "file-change",
    status: "completed",
    callId: `call-${id}`,
    stdout: null,
    stderr: null,
    approvalStatus: null,
    ...overrides,
  };
}

const PATCH = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,6 +1,8 @@
 import { createApp } from "./app";
+import { installTelemetry } from "./telemetry";

 export function main(): void {
-  createApp().start();
+  const app = createApp();
+  installTelemetry(app);
+  app.start();
 }
`;

const WORKFLOW_SNAPSHOT: WorkflowProgressSnapshot = {
  phases: [
    { index: 1, title: "Plan" },
    { index: 2, title: "Implement" },
    { index: 3, title: "Review" },
  ],
  agents: [
    {
      index: 1,
      label: "Draft the plan",
      state: "done",
      model: "claude-opus-4-1",
      attempt: 1,
      cached: false,
      lastProgressAt: T0 + 5_000,
      phaseIndex: 1,
      agentType: "planner",
      tokens: 12_400,
      toolCalls: 3,
      durationMs: 62_000,
    },
    {
      index: 2,
      label: "Implement the data layer",
      state: "done",
      model: "claude-sonnet-4-5",
      attempt: 1,
      cached: true,
      lastProgressAt: T0 + 6_000,
      phaseIndex: 2,
      agentType: "coder",
      tokens: 48_100,
      toolCalls: 19,
      durationMs: 184_000,
    },
    {
      index: 3,
      label: "Implement the screens",
      state: "running",
      model: "claude-sonnet-4-5",
      attempt: 2,
      cached: false,
      lastProgressAt: T0 + 7_000,
      phaseIndex: 2,
      agentType: "coder",
    },
    {
      index: 4,
      label: "Review for regressions",
      state: "queued",
      model: "claude-opus-4-1",
      attempt: 1,
      cached: false,
      lastProgressAt: T0 + 7_000,
      phaseIndex: 3,
      agentType: "reviewer",
    },
  ],
};

const FAILED_SNAPSHOT: WorkflowProgressSnapshot = {
  phases: [
    { index: 1, title: "Plan" },
    { index: 2, title: "Implement" },
  ],
  agents: [
    {
      index: 1,
      label: "Draft the plan",
      state: "done",
      model: "claude-opus-4-1",
      attempt: 1,
      cached: false,
      lastProgressAt: T0 + 5_000,
      phaseIndex: 1,
      durationMs: 30_000,
    },
    {
      index: 2,
      label: "Implement",
      state: "failed",
      model: "claude-sonnet-4-5",
      attempt: 3,
      cached: false,
      lastProgressAt: T0 + 6_000,
      phaseIndex: 2,
      error: "tsc exited with code 2",
      durationMs: 95_000,
    },
    {
      index: 3,
      label: "Write tests",
      state: "queued",
      model: "claude-sonnet-4-5",
      attempt: 1,
      cached: false,
      lastProgressAt: T0 + 6_000,
      phaseIndex: 2,
    },
  ],
};

function workflow(
  id: string,
  overrides: Partial<TimelineWorkflowWorkRow>,
): TimelineWorkflowWorkRow {
  const row = base(id, 5_000, null);
  return {
    ...row,
    kind: "work",
    workKind: "workflow",
    status: "pending",
    itemId: `task-${id}`,
    taskType: "local_workflow",
    workflowName: "Ship mobile Phase 4a",
    description: "Ship mobile Phase 4a",
    model: null,
    taskStatus: "running",
    workflow: WORKFLOW_SNAPSHOT,
    usage: null,
    summary: null,
    error: null,
    completedAt: null,
    ...overrides,
  };
}

/**
 * The prompt chip row's live inputs (`ThreadPromptChips`): two running
 * workflows and three background tasks (two commands, one agent), so the
 * Interactions showcase can render the row and its sheets without a provider.
 */
export function buildPromptChipWorkFixtures(): {
  workflows: TimelineWorkflowWorkRow[];
  backgroundCommands: TimelineWorkflowWorkRow[];
} {
  const startedAt = Date.now();
  return {
    workflows: [
      workflow("chip-wf-1", {
        workflowName: "fix-confirmed-bugs",
        description: "Fix the confirmed bugs from the triage pass",
        startedAt: startedAt - 4 * 60_000,
      }),
      workflow("chip-wf-2", {
        workflowName: "revise-one-pr",
        description: "Revise PR #2131 after review",
        startedAt: startedAt - 13 * 60_000,
        workflow: FAILED_SNAPSHOT,
      }),
    ],
    backgroundCommands: [
      workflow("chip-bg-1", {
        taskType: "local_bash",
        workflowName: null,
        description: "pnpm exec turbo run test --filter=@bb/server",
        workflow: null,
        startedAt: startedAt - 2 * 60_000,
      }),
      workflow("chip-bg-2", {
        taskType: "local_bash",
        workflowName: null,
        description: "scripts/bb-dev-app --port 4010",
        workflow: null,
        startedAt: startedAt - 9 * 60_000,
      }),
      workflow("chip-bg-3", {
        taskType: "local_agent",
        workflowName: null,
        description: "Audit the migration for missing indexes",
        model: "claude-opus-4-1",
        workflow: null,
        startedAt: startedAt - 40_000,
      }),
    ],
  };
}

type ApprovalFixture =
  | {
      approvalKind: "file-edit";
      lifecycle: "waiting" | "denied";
    }
  | {
      approvalKind: "permission-grant";
      lifecycle: "pending" | "resolving" | "granted" | "denied" | "interrupted";
      grantScope: "turn" | "session" | null;
      statusReason: string | null;
    };

function approval(
  id: string,
  fixture: ApprovalFixture,
  options: {
    status?: TimelineApprovalWorkRow["status"];
    toolName?: string | null;
  } = {},
): TimelineApprovalWorkRow {
  const shared = {
    ...base(id, 6_000, 0),
    kind: "work" as const,
    workKind: "approval" as const,
    status: options.status ?? ("completed" as const),
    interactionId: `int-${id}`,
    target: {
      itemId: `item-${id}`,
      toolName: options.toolName === undefined ? "Edit" : options.toolName,
    },
  };
  return fixture.approvalKind === "file-edit"
    ? { ...shared, ...fixture }
    : { ...shared, ...fixture };
}

function question(
  id: string,
  overrides: Partial<TimelineQuestionWorkRow>,
): TimelineQuestionWorkRow {
  return {
    ...base(id, 7_000, 0),
    kind: "work",
    workKind: "question",
    status: "completed",
    interactionId: `int-${id}`,
    lifecycle: "answered",
    questions: [
      {
        id: "q1",
        prompt: "Which storage should the mobile app use for drafts?",
        multiSelect: false,
        options: [
          { value: "mmkv", label: "MMKV" },
          { value: "sqlite", label: "SQLite" },
          { value: "secure", label: "SecureStore" },
        ],
        allowFreeText: true,
      },
      {
        id: "q2",
        prompt: "Anything else to keep in mind?",
        multiSelect: false,
        allowFreeText: true,
      },
    ],
    answers: {
      q1: { selected: ["mmkv"], freeText: "Keep the web key names." },
    },
    statusReason: null,
    ...overrides,
  };
}

function webSearch(
  id: string,
  queries: string[],
  status: TimelineWebSearchWorkRow["status"] = "completed",
): TimelineWebSearchWorkRow {
  const row = base(id, 8_000, 2_400);
  return {
    ...row,
    kind: "work",
    workKind: "web-search",
    status,
    callId: `call-${id}`,
    queries,
    completedAt: status === "pending" ? null : row.startedAt + 2_400,
  };
}

function webFetch(
  id: string,
  url: string,
  status: TimelineWebFetchWorkRow["status"] = "completed",
): TimelineWebFetchWorkRow {
  const row = base(id, 9_000, 900);
  return {
    ...row,
    kind: "work",
    workKind: "web-fetch",
    status,
    callId: `call-${id}`,
    url,
    prompt: "Summarize the page",
    pattern: null,
    completedAt: status === "pending" ? null : row.startedAt + 900,
  };
}

function imageView(id: string, path: string): TimelineImageViewWorkRow {
  const row = base(id, 10_000, 400);
  return {
    ...row,
    kind: "work",
    workKind: "image-view",
    status: "completed",
    callId: `call-${id}`,
    path,
    completedAt: row.startedAt + 400,
  };
}

function delegation(
  id: string,
  childRows: TimelineRow[],
  overrides: Partial<TimelineDelegationWorkRow> = {},
): TimelineDelegationWorkRow {
  const row = base(id, 11_000, 40_000);
  return {
    ...row,
    kind: "work",
    workKind: "delegation",
    status: "completed",
    callId: `call-${id}`,
    toolName: "Task",
    subagentType: "explore",
    description: "Find where the timeline rows are rendered",
    output:
      "The rows are rendered by `ThreadTimelineRows.tsx`; work bodies live in `TimelineRowDetails.tsx`.\n\n- Titles: `@bb/thread-view`\n- Auto-expand: `@bb/client-core`",
    completedAt: row.startedAt + 40_000,
    childRows,
    ...overrides,
  };
}

interface WorkRowFixtureSection {
  title: string;
  rows: TimelineRow[];
}

export function buildWorkRowFixtureSections(): WorkRowFixtureSection[] {
  seq = 0;
  return [
    {
      title: "Commands (ANSI output, failed, pending)",
      rows: [
        user("u-cmd", "Run the tests"),
        command("cmd-ok", {
          command: "pnpm exec vitest run src/diff",
          source: "agent",
          output: [
            `${ESC}[1m${ESC}[46m RUN ${ESC}[0m ${ESC}[36mv4.1.1${ESC}[0m`,
            ` ${ESC}[32m✓${ESC}[0m src/diff/parse-unified-diff.test.ts ${ESC}[2m(12 tests)${ESC}[0m`,
            ` ${ESC}[32m✓${ESC}[0m src/diff/diff-rows.test.ts ${ESC}[2m(6 tests)${ESC}[0m`,
            "",
            ` ${ESC}[2mTest Files${ESC}[0m  ${ESC}[1;32m2 passed${ESC}[0m ${ESC}[90m(2)${ESC}[0m`,
          ].join("\n"),
        }),
        command(
          "cmd-fail",
          {
            command:
              "pnpm exec turbo run typecheck --filter=@bb/mobile && echo 'a very long command line that wraps onto a second line and then some'",
            status: "error",
            exitCode: 2,
            output:
              "src/screens/x.tsx(12,3): error TS2322: Type 'string' is not assignable to type 'number'.\n\nFound 1 error.",
          },
          5_400,
        ),
        command(
          "cmd-pending",
          {
            command: "tail -f /var/log/system.log",
            output: Array.from(
              { length: 40 },
              (_, index) => `log line ${index + 1} streaming in`,
            ).join("\n"),
          },
          null,
        ),
      ],
    },
    {
      title:
        "Closed step with exploration (compact intents) + bare closed leaf",
      rows: [
        user("u-explore", "Look around"),
        command("read-a", {
          command: "cat src/a.ts",
          activityIntents: [
            {
              type: "read",
              command: "cat src/a.ts",
              name: "a.ts",
              path: "src/a.ts",
            },
            {
              type: "read",
              command: "cat /x/skills/deploy/SKILL.md",
              name: "SKILL.md",
              path: "/x/skills/deploy/SKILL.md",
            },
          ],
        }),
        tool("grep-b", {
          toolName: "Grep",
          activityIntents: [
            {
              type: "search",
              command: "Grep",
              query: "registerTimelineRowRenderer",
              path: "src",
            },
          ],
        }),
        tool("ls-c", {
          toolName: "LS",
          activityIntents: [
            { type: "list_files", command: "LS", path: "src/screens" },
          ],
        }),
        assistant("a-explore", "Found it."),
        command("read-single", {
          command: "cat src/b.ts",
          activityIntents: [
            {
              type: "read",
              command: "cat src/b.ts",
              name: "b.ts",
              path: "src/b.ts",
            },
          ],
        }),
        assistant("a-explore-2", "And that."),
      ],
    },
    {
      title: "Tools",
      rows: [
        user("u-tool", "Use a tool"),
        tool("tool-args", {
          toolName: "mcp__github__list_pull_requests",
          toolArgs: {
            owner: "get-bb",
            repo: "bb",
            state: "open",
            filters: { labels: ["mobile", "phase-4a"], draft: false },
            perPage: 50,
          },
          output: Array.from(
            { length: 30 },
            (_, index) =>
              `#${1900 - index} ${index % 3 === 0 ? "feat" : "fix"}(mobile): pull request title number ${index + 1} that is fairly long`,
          ).join("\n"),
        }),
        tool("tool-labels", {
          toolName: "deploy_preview",
          statusLabels: {
            pending: "Deploying preview",
            completed: "Deployed preview",
          },
          toolArgs: { branch: "bb/mobile" },
          output: "https://preview.example.com/bb-mobile",
        }),
        tool(
          "tool-pending",
          { toolName: "think", toolArgs: { depth: 3 } },
          null,
        ),
      ],
    },
    {
      title: "File changes",
      rows: [
        user("u-edit", "Add telemetry"),
        fileChange("fc-modify", {
          change: {
            path: "/Users/dev/repo/src/index.ts",
            kind: "modify",
            movePath: null,
            diff: PATCH,
            diffStats: { added: 4, removed: 1 },
          },
        }),
        fileChange("fc-create", {
          change: {
            path: "/Users/dev/repo/src/telemetry.ts",
            kind: "create",
            movePath: null,
            diff: "export function installTelemetry(app: App): void {\n  app.use(telemetry());\n}\n",
            diffStats: { added: 3, removed: 0 },
          },
          stderr: "warning: src/telemetry.ts was formatted on save",
        }),
        fileChange("fc-none", {
          change: {
            path: "/Users/dev/repo/README.md",
            kind: "modify",
            movePath: null,
            diff: null,
            diffStats: { added: 0, removed: 0 },
          },
          status: "error",
        }),
      ],
    },
    {
      title: "Web search / fetch / image view",
      rows: [
        user("u-web", "Research"),
        webSearch("ws-1", [
          "expo-image cookies iOS",
          "FlashList v2 sticky bottom",
        ]),
        webSearch("ws-2", ["react native text clipping last line"], "pending"),
        webFetch("wf-1", "https://docs.expo.dev/versions/latest/sdk/image/"),
        webFetch("wf-2", "https://example.com/slow", "error"),
        imageView("iv-1", "/Users/dev/repo/apps/mobile/assets/icon.png"),
      ],
    },
    {
      title: "Approvals (read-only) and questions",
      rows: [
        user("u-approval", "Edit the file"),
        approval("ap-granted", {
          approvalKind: "permission-grant",
          lifecycle: "granted",
          grantScope: "session",
          statusReason: null,
        }),
        approval(
          "ap-denied",
          {
            approvalKind: "permission-grant",
            lifecycle: "denied",
            grantScope: null,
            statusReason: null,
          },
          { toolName: "Bash" },
        ),
        approval(
          "ap-pending",
          {
            approvalKind: "permission-grant",
            lifecycle: "pending",
            grantScope: null,
            statusReason: null,
          },
          { status: "pending", toolName: "WebFetch" },
        ),
        approval(
          "ap-interrupted",
          {
            approvalKind: "permission-grant",
            lifecycle: "interrupted",
            grantScope: null,
            statusReason: "thread stopped",
          },
          { status: "interrupted" },
        ),
        approval(
          "ap-file-waiting",
          { approvalKind: "file-edit", lifecycle: "waiting" },
          { status: "pending", toolName: null },
        ),
        question("q-answered", {}),
        question("q-pending", {
          lifecycle: "pending",
          status: "pending",
          answers: null,
          questions: [
            {
              id: "q1",
              prompt: "Ship the dev showcase too?",
              multiSelect: false,
              options: [
                { value: "y", label: "Yes" },
                { value: "n", label: "No" },
              ],
              allowFreeText: false,
            },
          ],
        }),
      ],
    },
    {
      title: "Delegation (children flatten one depth down) + workflows",
      rows: [
        user("u-delegate", "Delegate"),
        delegation("del-1", [
          command("del-cmd", {
            command: "rg -n registerTimelineRowRenderer src",
            activityIntents: [
              {
                type: "search",
                command: "rg",
                query: "registerTimelineRowRenderer",
                path: "src",
              },
            ],
          }),
          tool("del-read", {
            toolName: "Read",
            activityIntents: [
              {
                type: "read",
                command: "Read",
                name: "renderers.ts",
                path: "src/screens/thread/timeline/renderers.ts",
              },
            ],
          }),
          command("del-run", {
            command: "pnpm exec vitest run rows",
            output: "16 passed",
          }),
        ]),
        delegation(
          "del-pending",
          [command("del-p-cmd", { command: "sleep 30" }, null)],
          {
            status: "pending",
            completedAt: null,
            output: "",
            description: "Audit the diff renderer",
            subagentType: "reviewer",
          },
        ),
        workflow("wf-running", {}),
        workflow("wf-done", {
          status: "completed",
          taskStatus: "completed",
          workflowName: "Nightly audit",
          description: "Nightly audit",
          workflow: {
            ...FAILED_SNAPSHOT,
            agents: FAILED_SNAPSHOT.agents.map((agent) => ({
              ...agent,
              state: "done" as const,
              error: undefined,
            })),
          },
          usage: { totalTokens: 152_000, toolUses: 41, durationMs: 512_000 },
          summary: "All checks passed.",
          completedAt: T0 + 600_000,
        }),
        workflow("wf-failed", {
          status: "error",
          taskStatus: "failed",
          workflowName: "Release train",
          description: "Release train",
          workflow: FAILED_SNAPSHOT,
          error: "Phase 2 failed: tsc exited with code 2",
          usage: { totalTokens: 88_000, toolUses: 12, durationMs: 130_000 },
          completedAt: T0 + 130_000,
        }),
        workflow("wf-bash", {
          taskType: "local_bash",
          workflowName: null,
          description: "pnpm dev --port 8082",
          workflow: null,
          status: "completed",
          taskStatus: "completed",
          summary: "Metro started on 8082",
          completedAt: T0 + 9_000,
        }),
        workflow("wf-agent-degraded", {
          taskType: "local_agent",
          workflowName: null,
          description: "Background reviewer",
          workflow: null,
          status: "interrupted",
          taskStatus: "stopped",
          completedAt: T0 + 9_000,
        }),
        assistant("a-done", "All done."),
      ],
    },
  ];
}
