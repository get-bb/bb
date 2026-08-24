import type { WorkflowProgressSnapshot } from "@bb/domain";
import type {
  TimelineApprovalWorkRow,
  TimelineQuestionWorkRow,
  TimelineRow,
  TimelineToolWorkRow,
  TimelineWorkflowWorkRow,
} from "@bb/server-contract";
import { buildTimelineViewRows } from "@bb/thread-view";
import { describe, expect, it } from "vitest";
import { buildTimelineListItems } from "../../rows";
import { assistantRow, commandRow, userRow } from "../../test-fixtures";
import {
  activeWorkflowPhaseKey,
  answeredQuestionEntries,
  buildWorkflowAgentStats,
  compactActivityIntentTitles,
  deriveWorkflowAgentDisplayState,
  describeApprovalDecision,
  estimateToolHeaderLines,
  formatWorkflowUsage,
  groupWorkflowAgentsByPhase,
  isInsideWorkSummary,
  isPastWorkRow,
  leadingIconForWorkRow,
  leadingIconTintForWorkRow,
  leadingPluginIconUrl,
  resolvePluginIconUrl,
  toolArgEntries,
  workflowBodyKind,
  workflowPhaseStripState,
  workflowStatusPillState,
} from "./work-row-model";

function base(id: string, seq: number) {
  return {
    id,
    threadId: "t1",
    turnId: "turn-1",
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    startedAt: 1_000 + seq,
    createdAt: 1_000 + seq,
  };
}

function toolRow(
  id: string,
  overrides: Partial<TimelineToolWorkRow> = {},
): TimelineToolWorkRow {
  return {
    ...base(id, 10),
    kind: "work",
    workKind: "tool",
    status: "completed",
    callId: `call-${id}`,
    toolName: "Read",
    toolArgs: null,
    output: "",
    completedAt: 2_000,
    approvalStatus: null,
    ...overrides,
  };
}

function workflowRow(
  overrides: Partial<TimelineWorkflowWorkRow> = {},
): TimelineWorkflowWorkRow {
  return {
    ...base("wf", 20),
    kind: "work",
    workKind: "workflow",
    status: "pending",
    itemId: "task-1",
    taskType: "local_workflow",
    workflowName: "Ship it",
    description: "Ship the feature",
    model: null,
    taskStatus: "running",
    workflow: null,
    usage: null,
    summary: null,
    error: null,
    completedAt: null,
    ...overrides,
  };
}

function approvalRow(
  overrides: Partial<TimelineApprovalWorkRow>,
): TimelineApprovalWorkRow {
  return {
    ...base("ap", 30),
    kind: "work",
    workKind: "approval",
    status: "completed",
    interactionId: "int-1",
    target: { itemId: "item-1", toolName: "Edit" },
    approvalKind: "permission-grant",
    lifecycle: "granted",
    grantScope: "session",
    statusReason: null,
    ...overrides,
  } as TimelineApprovalWorkRow;
}

function questionRow(
  overrides: Partial<TimelineQuestionWorkRow> = {},
): TimelineQuestionWorkRow {
  return {
    ...base("q", 40),
    kind: "work",
    workKind: "question",
    status: "completed",
    interactionId: "int-2",
    lifecycle: "answered",
    questions: [
      {
        id: "q1",
        prompt: "Which color?",
        multiSelect: false,
        options: [
          { value: "r", label: "Red" },
          { value: "b", label: "Blue" },
        ],
        allowFreeText: true,
      },
      {
        id: "q2",
        prompt: "Anything else?",
        multiSelect: false,
        allowFreeText: true,
      },
    ],
    answers: {
      q1: { selected: ["b", "unknown"], freeText: "maybe green" },
    },
    statusReason: null,
    ...overrides,
  };
}

describe("leadingIconForWorkRow", () => {
  it("maps kinds and exploration intents to glyphs", () => {
    expect(leadingIconForWorkRow(commandRow("c", "ls"))).toBe("Terminal");
    expect(
      leadingIconForWorkRow(
        commandRow("c", "cat a.ts", {
          activityIntents: [
            { type: "read", command: "cat a.ts", name: "a.ts", path: "a.ts" },
          ],
        }),
      ),
    ).toBe("FileText");
    expect(
      leadingIconForWorkRow(
        commandRow("c", "rg foo", {
          activityIntents: [
            { type: "search", command: "rg foo", query: "foo", path: null },
          ],
        }),
      ),
    ).toBe("Search");
    expect(
      leadingIconForWorkRow(
        commandRow("c", "cat /x/skills/deploy/SKILL.md", {
          activityIntents: [
            {
              type: "read",
              command: "cat /x/skills/deploy/SKILL.md",
              name: "SKILL.md",
              path: "/x/skills/deploy/SKILL.md",
            },
          ],
        }),
      ),
    ).toBe("Zap");
    expect(leadingIconForWorkRow(toolRow("t"))).toBe("Terminal");
    expect(leadingIconForWorkRow(workflowRow())).toBe("ListTodo");
    expect(leadingIconForWorkRow(workflowRow({ taskType: "local_bash" }))).toBe(
      "Terminal",
    );
    expect(
      leadingIconForWorkRow(workflowRow({ taskType: "local_subagent" })),
    ).toBe("UserRoundPlus");
    expect(leadingIconForWorkRow(approvalRow({}))).toBe("Lock");
  });
});

describe("presentation-driven glyph and tint", () => {
  const presentation = {
    label: { pending: "Stamping receipt", completed: "Stamped receipt" },
    icon: { glyph: "Check" },
    tint: { light: "#1d4ed8", dark: "#93c5fd" },
  };

  it("prefers the bridge's glyph when the host knows it, else the per-kind glyph", () => {
    expect(leadingIconForWorkRow(toolRow("t", { presentation }))).toBe("Check");
    expect(
      leadingIconForWorkRow(
        toolRow("t", {
          presentation: { ...presentation, icon: { glyph: "NotAGlyph" } },
        }),
      ),
    ).toBe("Terminal");
    // A skill read keeps its Zap even with a presentation glyph.
    expect(
      leadingIconForWorkRow(
        commandRow("c", "cat /x/skills/deploy/SKILL.md", {
          presentation,
          activityIntents: [
            {
              type: "read",
              command: "cat /x/skills/deploy/SKILL.md",
              name: "SKILL.md",
              path: "/x/skills/deploy/SKILL.md",
            },
          ],
        }),
      ),
    ).toBe("Zap");
  });

  it("resolves a parsed namespaced glyph for the approval banner: present, absent, and prototype-shaped names", () => {
    const icons = {
      receipt: "/api/v1/plugins/echo-provider/assets/icons/receipt.svg?h=abc",
    };
    const plugins = [{ id: "echo-provider", icons }];
    const glyph = { pluginId: "echo-provider", name: "receipt" };
    expect(resolvePluginIconUrl(glyph, plugins)).toBe(icons.receipt);
    // Uninstalled, not loaded yet, another plugin, or the name undeclared:
    // null, so the banner draws the host glyph or Terminal with no fetch.
    expect(resolvePluginIconUrl(glyph, [])).toBeNull();
    expect(resolvePluginIconUrl(glyph, undefined)).toBeNull();
    expect(
      resolvePluginIconUrl(glyph, [{ id: "other-plugin", icons }]),
    ).toBeNull();
    expect(
      resolvePluginIconUrl(
        { pluginId: "echo-provider", name: "stamp" },
        plugins,
      ),
    ).toBeNull();
    // The wire `icons` record is a plain object: a declared-name-shaped
    // glyph that is an Object.prototype key must not resolve to a function.
    for (const name of ["constructor", "toString", "__proto__"]) {
      expect(
        resolvePluginIconUrl({ pluginId: "echo-provider", name }, plugins),
      ).toBeNull();
    }
  });

  it("resolves a plugin-declared icon against the installed plugins, else falls back to the per-kind glyph", () => {
    const namespaced = {
      ...presentation,
      icon: { glyph: "echo-provider/receipt" },
    };
    const plugins = [
      {
        id: "echo-provider",
        icons: {
          receipt:
            "/api/v1/plugins/echo-provider/assets/icons/receipt.svg?h=abc",
        },
      },
    ];
    const row = toolRow("t", { presentation: namespaced });
    expect(leadingPluginIconUrl(row, plugins)).toBe(
      "/api/v1/plugins/echo-provider/assets/icons/receipt.svg?h=abc",
    );
    // The namespaced glyph is not a host glyph, so the per-kind glyph is
    // what draws while the SVG loads and when it cannot be resolved.
    expect(leadingIconForWorkRow(row)).toBe("Terminal");
    // Renamed, undeclared, other plugin, uninstalled, or not loaded yet.
    expect(
      leadingPluginIconUrl(row, [{ id: "echo-provider", icons: {} }]),
    ).toBeNull();
    expect(
      leadingPluginIconUrl(row, [{ id: "other-plugin", icons: plugins[0]!.icons }]),
    ).toBeNull();
    expect(leadingPluginIconUrl(row, [])).toBeNull();
    expect(leadingPluginIconUrl(row, undefined)).toBeNull();
    // A legal declared name that is also an Object.prototype key must not
    // resolve to the prototype's function when the plugin did not declare it.
    expect(
      leadingPluginIconUrl(
        toolRow("t", {
          presentation: { ...namespaced, icon: { glyph: "echo-provider/constructor" } },
        }),
        plugins,
      ),
    ).toBeNull();
    // A host glyph never resolves to a URL.
    expect(leadingPluginIconUrl(toolRow("t", { presentation }), plugins)).toBeNull();
    // A skill read keeps its Zap over a declared icon, as on the web.
    expect(
      leadingPluginIconUrl(
        commandRow("c", "cat /x/skills/deploy/SKILL.md", {
          presentation: namespaced,
          activityIntents: [
            {
              type: "read",
              command: "cat /x/skills/deploy/SKILL.md",
              name: "SKILL.md",
              path: "/x/skills/deploy/SKILL.md",
            },
          ],
        }),
        plugins,
      ),
    ).toBeNull();
  });

  it("picks the tint for the theme mode and refuses non-colour values", () => {
    const row = toolRow("t", { presentation });
    expect(leadingIconTintForWorkRow(row, "light")).toBe("#1d4ed8");
    expect(leadingIconTintForWorkRow(row, "dark")).toBe("#93c5fd");
    expect(leadingIconTintForWorkRow(toolRow("t"), "light")).toBeUndefined();
    expect(
      leadingIconTintForWorkRow(
        toolRow("t", {
          presentation: {
            ...presentation,
            tint: { light: "url(evil)", dark: "#fff" },
          },
        }),
        "light",
      ),
    ).toBeUndefined();
    expect(leadingIconTintForWorkRow(approvalRow({}), "light")).toBeUndefined();
  });

  it("refuses a colour the native parser cannot paint, per side", () => {
    // The domain grammar accepts every CSS colour function because the web
    // paints them through CSS; React Native's parser does not know
    // `oklch()`, `lab()`, `color()` or a percentage alpha, and a value it
    // rejects paints the glyph black. Each side falls back on its own.
    const row = toolRow("t", {
      presentation: {
        ...presentation,
        tint: { light: "oklch(0.6 0.15 250)", dark: "#fff" },
      },
    });
    expect(leadingIconTintForWorkRow(row, "light")).toBeUndefined();
    expect(leadingIconTintForWorkRow(row, "dark")).toBe("#fff");
    for (const unpaintable of [
      "lab(50% 20 -30)",
      "color(display-p3 1 0 0)",
      "rgb(0 0 0 / 50%)",
      "hsl(220 80% 50% / 0.5)",
    ]) {
      expect(
        leadingIconTintForWorkRow(
          toolRow("t", {
            presentation: {
              ...presentation,
              tint: { light: unpaintable, dark: unpaintable },
            },
          }),
          "light",
        ),
        unpaintable,
      ).toBeUndefined();
    }
    // The forms the parser does paint pass through unchanged.
    for (const paintable of [
      "rgb(29 78 216 / 0.5)",
      "hsl(220, 80%, 50%)",
      "rebeccapurple",
    ]) {
      expect(
        leadingIconTintForWorkRow(
          toolRow("t", {
            presentation: {
              ...presentation,
              tint: { light: paintable, dark: paintable },
            },
          }),
          "dark",
        ),
      ).toBe(paintable);
    }
  });
});

describe("isPastWorkRow", () => {
  it("dims only completed rows", () => {
    expect(isPastWorkRow(commandRow("c", "ls"))).toBe(true);
    expect(isPastWorkRow(commandRow("c", "ls", { status: "pending" }))).toBe(
      false,
    );
    expect(isPastWorkRow(commandRow("c", "ls", { status: "error" }))).toBe(
      false,
    );
  });
});

describe("compactActivityIntentTitles", () => {
  const readA = commandRow("r1", "cat a.ts", {
    activityIntents: [
      { type: "read", command: "cat a.ts", name: "a.ts", path: "src/a.ts" },
      { type: "read", command: "cat b.ts", name: "b.ts", path: "src/b.ts" },
    ],
  });

  it("recognizes step/bundle summary parents", () => {
    expect(isInsideWorkSummary(null)).toBe(false);
    expect(isInsideWorkSummary("turn")).toBe(false);
    expect(isInsideWorkSummary("work:delegation")).toBe(false);
    expect(isInsideWorkSummary("step-summary")).toBe(true);
    expect(isInsideWorkSummary("bundle-summary")).toBe(true);
  });

  it("splits an exploration row inside a summary into one title per intent", () => {
    const titles = compactActivityIntentTitles(readA, "step-summary");
    expect(titles?.map((entry) => entry.title.plain)).toEqual([
      "Read src/a.ts",
      "Read src/b.ts",
    ]);
    expect(titles?.every((entry) => entry.intentType === "read")).toBe(true);
  });

  it("keeps the regular title outside summaries, for approvals, and without intents", () => {
    expect(compactActivityIntentTitles(readA, null)).toBeNull();
    expect(
      compactActivityIntentTitles(
        { ...readA, approvalStatus: "denied" },
        "bundle-summary",
      ),
    ).toBeNull();
    expect(
      compactActivityIntentTitles(commandRow("c", "make"), "step-summary"),
    ).toBeNull();
  });

  it("compacts the children the list model flattens under a closed-step summary", () => {
    const rows: TimelineRow[] = [
      userRow("u1", "go"),
      readA,
      commandRow("r2", "ls", {
        activityIntents: [{ type: "list_files", command: "ls", path: "src" }],
      }),
      assistantRow("a1", "done"),
    ];
    const summary = buildTimelineViewRows(rows).find(
      (row) => row.kind === "step-summary",
    );
    expect(summary).toBeDefined();
    const items = buildTimelineListItems({
      rows,
      scopeActive: false,
      isExpanded: (rowId) => rowId === summary!.id,
    });
    const children = items.filter((item) => item.parentKind !== null);
    expect(children.map((item) => item.parentKind)).toEqual([
      "step-summary",
      "step-summary",
    ]);
    expect(
      children.map((item) =>
        item.kind === "work:command"
          ? compactActivityIntentTitles(item.row, item.parentKind)?.map(
              (entry) => entry.title.plain,
            )
          : null,
      ),
    ).toEqual([["Read src/a.ts", "Read src/b.ts"], ["Listed files in src"]]);
  });
});

describe("toolArgEntries", () => {
  it("formats scalar args inline and objects as pretty JSON", () => {
    expect(
      toolArgEntries({
        path: "src/a.ts",
        count: 3,
        dry: false,
        nothing: null,
        nested: { a: [1, 2] },
      }),
    ).toEqual([
      { key: "path", value: "src/a.ts" },
      { key: "count", value: "3" },
      { key: "dry", value: "false" },
      { key: "nothing", value: "null" },
      { key: "nested", value: '{\n  "a": [\n    1,\n    2\n  ]\n}' },
    ]);
    expect(toolArgEntries(null)).toEqual([]);
  });
});

describe("describeApprovalDecision", () => {
  it("maps lifecycles to decision glyphs with the grant scope", () => {
    expect(describeApprovalDecision(approvalRow({}))).toEqual({
      icon: "Check",
      tone: "granted",
      label: "Granted for this session",
    });
    expect(
      describeApprovalDecision(
        approvalRow({ lifecycle: "granted", grantScope: null }),
      ).label,
    ).toBe("Granted");
    expect(
      describeApprovalDecision(approvalRow({ lifecycle: "denied" })),
    ).toEqual({ icon: "X", tone: "denied", label: "Denied" });
    expect(
      describeApprovalDecision(approvalRow({ lifecycle: "pending" })).tone,
    ).toBe("pending");
    expect(
      describeApprovalDecision(approvalRow({ lifecycle: "interrupted" })),
    ).toEqual({ icon: "Pause", tone: "muted", label: "Interrupted" });
    expect(
      describeApprovalDecision(
        approvalRow({ approvalKind: "file-edit", lifecycle: "waiting" }),
      ),
    ).toEqual({ icon: "Clock", tone: "pending", label: "Waiting" });
  });
});

describe("answeredQuestionEntries", () => {
  it("returns null for pending and interrupted rows", () => {
    expect(answeredQuestionEntries(questionRow({ lifecycle: "pending" }))).toBe(
      null,
    );
    expect(
      answeredQuestionEntries(questionRow({ lifecycle: "interrupted" })),
    ).toBeNull();
  });

  it("labels selected options, keeps raw values for unknown ones, and marks unanswered prompts", () => {
    expect(answeredQuestionEntries(questionRow())).toEqual([
      {
        id: "q1",
        prompt: "Which color?",
        selectedLabels: ["Blue", "unknown"],
        freeText: "maybe green",
      },
      {
        id: "q2",
        prompt: "Anything else?",
        selectedLabels: [],
        freeText: null,
      },
    ]);
    expect(
      answeredQuestionEntries(
        questionRow({ lifecycle: "resolving", answers: null }),
      ),
    ).toEqual([
      { id: "q1", prompt: "Which color?", selectedLabels: [], freeText: null },
      {
        id: "q2",
        prompt: "Anything else?",
        selectedLabels: [],
        freeText: null,
      },
    ]);
  });
});

describe("workflow helpers", () => {
  const snapshot: WorkflowProgressSnapshot = {
    phases: [
      { index: 1, title: "Plan" },
      { index: 2, title: "Build" },
      { index: 3, title: "Review" },
    ],
    agents: [
      {
        index: 1,
        label: "Draft plan",
        state: "done",
        model: "claude-opus-4",
        attempt: 1,
        cached: false,
        lastProgressAt: 1,
        phaseIndex: 1,
        agentType: "planner",
        tokens: 12_400,
        toolCalls: 1,
        durationMs: 62_000,
      },
      {
        index: 2,
        label: "Implement",
        state: "running",
        model: "claude-sonnet-4",
        attempt: 2,
        cached: false,
        lastProgressAt: 2,
        phaseIndex: 2,
      },
      {
        index: 3,
        label: "Implement tests",
        state: "queued",
        model: "claude-sonnet-4",
        attempt: 1,
        cached: true,
        lastProgressAt: 3,
        phaseIndex: 2,
      },
      {
        index: 4,
        label: "Stray",
        state: "failed",
        model: "gpt-5",
        attempt: 1,
        cached: false,
        lastProgressAt: 4,
        error: "boom",
      },
    ],
  };

  it("groups agents by phase and appends an unphased group", () => {
    const groups = groupWorkflowAgentsByPhase(snapshot);
    expect(groups.map((group) => group.phase?.title ?? null)).toEqual([
      "Plan",
      "Build",
      "Review",
      null,
    ]);
    expect(groups[1]?.agents.map((agent) => agent.index)).toEqual([2, 3]);
    expect(groups[3]?.agents.map((agent) => agent.index)).toEqual([4]);
    expect(activeWorkflowPhaseKey(groups)).toBe("phase-2");
  });

  it("derives interrupted display state and stats", () => {
    const running = snapshot.agents[1]!;
    expect(deriveWorkflowAgentDisplayState(running, false)).toBe("running");
    expect(deriveWorkflowAgentDisplayState(running, true)).toBe("interrupted");
    expect(buildWorkflowAgentStats(snapshot.agents[0]!, "done")).toEqual({
      meta: "planner · opus · 12.4k tok · 1 tool",
      duration: "1m02s",
    });
    expect(buildWorkflowAgentStats(running, "interrupted")).toEqual({
      meta: "sonnet · attempt 2 · stopped",
      duration: null,
    });
    expect(buildWorkflowAgentStats(snapshot.agents[2]!, "queued").meta).toBe(
      "sonnet · cached · queued",
    );
  });

  it("colors the phase strip by group state", () => {
    const groups = groupWorkflowAgentsByPhase(snapshot);
    expect(workflowPhaseStripState(groups[0]!, false, false)).toBe("done");
    expect(workflowPhaseStripState(groups[1]!, true, false)).toBe("active");
    expect(workflowPhaseStripState(groups[2]!, false, false)).toBe("upcoming");
    expect(workflowPhaseStripState(groups[2]!, false, true)).toBe("upcoming");
    expect(workflowPhaseStripState(groups[3]!, false, true)).toBe("failed");
  });

  it("maps task status to the terminal chip and formats usage", () => {
    expect(workflowStatusPillState("running")).toBeNull();
    expect(workflowStatusPillState("paused")).toBeNull();
    expect(workflowStatusPillState("pending")).toBe("queued");
    expect(workflowStatusPillState("completed")).toBe("completed");
    expect(workflowStatusPillState("killed")).toBe("failed");
    expect(workflowStatusPillState("stopped")).toBe("cancelled");
    expect(
      formatWorkflowUsage({
        totalTokens: 1_500_000,
        toolUses: 1,
        durationMs: 5_000,
      }),
    ).toBe("1.5m tok · 1 tool · 5s");
    expect(
      formatWorkflowUsage({ totalTokens: 0, toolUses: 0, durationMs: 0 }),
    ).toBe(null);
    expect(formatWorkflowUsage(null)).toBeNull();
  });

  it("picks the body: tree, then summary/error text, else none", () => {
    expect(workflowBodyKind(workflowRow({ workflow: snapshot }))).toEqual({
      kind: "tree",
      snapshot,
    });
    expect(
      workflowBodyKind(workflowRow({ status: "error", error: "exploded" })),
    ).toEqual({ kind: "text", text: "exploded" });
    expect(
      workflowBodyKind(
        workflowRow({ status: "completed", summary: "ok", error: "ignored" }),
      ),
    ).toEqual({ kind: "text", text: "ok" });
    expect(workflowBodyKind(workflowRow())).toEqual({ kind: "none" });
  });
});

describe("estimateToolHeaderLines", () => {
  it("counts the tool name, one line per argument, wrapped and multi-line values", () => {
    expect(estimateToolHeaderLines("Read", [], 40)).toBe(1);
    expect(
      estimateToolHeaderLines(
        "Read",
        [
          { key: "path", value: "a.ts" },
          { key: "json", value: '{\n  "a": 1\n}' },
          { key: "long", value: "x".repeat(90) },
        ],
        40,
      ),
    ).toBe(1 + 1 + 3 + 3);
  });
});
