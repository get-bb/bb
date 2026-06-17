import type { TimelineRow } from "@bb/server-contract";
import { ThreadTimelineRows } from "@/components/thread/timeline";
import { toolRow } from "@/test/fixtures/thread-timeline-rows";
import { StoryCard, StoryRow } from "../../../../../.ladle/story-card";

export default {
  title: "thread/timeline/rows/Tool",
};

function TimelineStage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

const baseProps = {
  threadRuntimeDisplayStatus: "idle" as const,
  workspaceRootPath: undefined,
};

// ---------------------------------------------------------------------------
// Real tool work rows pulled from live threads in ~/.bb-dev/bb.db. These are
// the catch-all "tool" rows — tools that aren't classified as activity intents
// on a command row (Read/Grep/Glob/list_files/search go on commands instead).
// Common tools that surface here: TodoWrite, ToolSearch, notify_user, Skill,
// ScheduleWakeup. Real toolName, toolArgs, and output JSON are inlined below.
// ---------------------------------------------------------------------------

// thr_yn2i6jeaca, seq 760/761, turn turn_8840389c92b04db7_1 — ToolSearch
// resolving a deferred TodoWrite schema. Tiny arguments object, one-line
// result. Different visual shape from TodoWrite (no arrays, scalar args).
const toolSearchTool: TimelineRow = toolRow({
  id: "thr_yn2i6jeaca:tool:toolu_0191NxebN8QhTioHDkJ3awer",
  threadId: "thr_yn2i6jeaca",
  turnId: "turn_8840389c92b04db7_1",
  sourceSeqStart: 760,
  sourceSeqEnd: 761,
  startedAt: 1776880211436,
  createdAt: 1776880211541,
  status: "completed",
  callId: "toolu_0191NxebN8QhTioHDkJ3awer",
  toolName: "ToolSearch",
  toolArgs: {
    query: "select:TodoWrite",
    max_results: 1,
  },
  output: "Matched tools: TodoWrite",
  approvalStatus: null,
  activityIntents: [],
  durationMs: 105,
});

// thr_bj3p5vk9py, seq 13, turn 019de9bd-c299-7053-b11d-11b1f40e8b83 —
// parent thread sending an introductory notify_user. Free-form text
// arg, "Notification delivered" result.
const notifyUserShort: TimelineRow = toolRow({
  id: "thr_bj3p5vk9py:tool:call_MZFh9Lp2X4LkW9gQteoyDB2F",
  threadId: "thr_bj3p5vk9py",
  turnId: "019de9bd-c299-7053-b11d-11b1f40e8b83",
  sourceSeqStart: 13,
  sourceSeqEnd: 13,
  startedAt: 1777743031156,
  createdAt: 1777743031156,
  status: "completed",
  callId: "call_MZFh9Lp2X4LkW9gQteoyDB2F",
  toolName: "notify_user",
  toolArgs: {
    text: "Hi — I’m your bb parent thread for this project. I’ll coordinate work by delegating substantive coding, debugging, and investigation tasks to child threads in isolated worktrees, then review results and report back.\n\nA few quick preferences so I can work the way you like:\n1. What should I call you?\n2. Do you prefer heavy delegation with concise summaries, or more hands-on collaboration with more frequent check-ins?\n3. What kinds of tasks should I expect most often: implementation, debugging, planning/reviews, or something else?",
  },
  output: "Notification delivered",
  approvalStatus: null,
  activityIntents: [],
  durationMs: 0,
});

// thr_bj3p5vk9py, seq 28209 — parent merge-evaluation summary. Long
// markdown body in args.text (multi-section, tables, code-fence-ish lists).
// Useful for the "expanded" story so we can see how long tool-arg payloads
// render inside the row body.
const notifyUserLong: TimelineRow = toolRow({
  id: "thr_bj3p5vk9py:tool:call_llaogf7VfpS1YkeQ2iIPUuL7",
  threadId: "thr_bj3p5vk9py",
  turnId: "019de9bd-c299-7053-b11d-11b1f40e8b83",
  sourceSeqStart: 28209,
  sourceSeqEnd: 28209,
  startedAt: 1777800000000,
  createdAt: 1777800000000,
  status: "completed",
  callId: "call_llaogf7VfpS1YkeQ2iIPUuL7",
  toolName: "notify_user",
  toolArgs: {
    text: "Here’s the merge-evaluation summary.\n\n## 1. `bb/daemon-protocol-phase6-cleanup`\n\n**Status:** code complete, validated by worker, Claude review active. **Not merging without your explicit go-ahead.**\n\n**Commits over `main` (`d75f390c`):**\n- `452df600` — remove daemon high-water response compatibility\n- `c1261311` — remove completed daemon cutover scaffolding\n\n**Diff:** 19 files, **+75 / -3502**, net **-3427 LOC**.\n\n| Area | Files | Diff | Responsibility |\n| --- | --- | ---: | --- |\n| One-off cutover tooling/docs | server migration script, runner, test, runbook | **-2945** | Delete post-live-migration executable scaffolding. Git history is the archive. |\n| Plans/docs cleanup | delete completed host cutover plan; update simplification/complexity plans | **-415** | Keep roadmap accurate; remove completed plan per AGENTS.md. |\n| Server runtime/tests/package | command-result route, session route, events comment, package dep/script, tests | **-62** | Remove response high-water computation and stale naming. |\n| Host daemon tests/helpers | test server/session result expectations | **-14** | Stop modeling high-water marks in daemon-facing tests. |\n| Contract package | session response schemas/tests | **+13** | Tighten contract to reject removed field. |\n| DB public surface | `packages/db/src/data/index.ts` | **-1** | Stop exporting internal `getHighWaterMarks`. |\n\n### Contract boundary changes\n- `/internal/session/open` response no longer includes `threadHighWaterMarks`.\n- `/internal/session/command-result` response is now strictly `{ ok: true }`.\n- Contract schemas are `.strict()`, so old response fields are rejected rather than silently tolerated.\n- Host daemon tests now assert the removed field is absent/rejected.\n\n### Main risk / decision\nThe big decision is whether we are comfortable deleting the one-off migration tooling now. It’s the right simplification move after successful live cutover, but it is a burn-the-bridge step; recovery would be via git history, not a current script.",
  },
  output: "Notification delivered",
  approvalStatus: null,
  activityIntents: [],
  durationMs: 50,
});

// Running tool — status=pending, output empty, completedAt null. Reuses the
// real TodoWrite arg shape from above (the agent often issues TodoWrites
// mid-turn) and parks it as in-flight using Date.now() so the relative-time
// formatting stays sensible whenever the storybook is rendered.
const runningTool: TimelineRow = toolRow({
  id: "thr_yn2i6jeaca:tool:toolu_running",
  threadId: "thr_yn2i6jeaca",
  turnId: "turn_8840389c92b04db7_1",
  sourceSeqStart: 900,
  sourceSeqEnd: 900,
  startedAt: Date.now(),
  createdAt: Date.now(),
  status: "pending",
  callId: "toolu_running",
  toolName: "TodoWrite",
  toolArgs: {
    todos: [
      {
        content:
          "Verify dead code claim: timeline-activity-group-summary.ts & timeline-assistant-grouping.ts have no consumers",
        status: "in_progress",
        activeForm: "Verifying dead-code claim on two timeline modules",
      },
    ],
  },
  output: "",
  approvalStatus: null,
  activityIntents: [],
  durationMs: null,
});

// Errored tool — reuses a real ToolSearch shape but with status=error and a
// failure result string standing in for the captured error message. Real
// errored ToolSearch payloads are rare in the local DB, so we hold the
// toolName/toolArgs constant from a real call and only swap the status.
const errorTool: TimelineRow = toolRow({
  id: "thr_yn2i6jeaca:tool:toolu_error",
  threadId: "thr_yn2i6jeaca",
  turnId: "turn_8840389c92b04db7_1",
  sourceSeqStart: 901,
  sourceSeqEnd: 902,
  startedAt: 1776880300000,
  createdAt: 1776880300100,
  status: "error",
  callId: "toolu_error",
  toolName: "ToolSearch",
  toolArgs: {
    query: "select:TodoWrite",
    max_results: 1,
  },
  output: "Tool failed: deferred tool registry unavailable",
  approvalStatus: null,
  activityIntents: [],
  durationMs: 100,
});

// Interrupted tool — reuses a real notify_user shape but with
// status=interrupted (the user steered/aborted before the message was
// delivered). Real interrupted notify_user payloads are rare; the
// toolName/toolArgs are real, only the status is adjusted.
const interruptedTool: TimelineRow = toolRow({
  id: "thr_bj3p5vk9py:tool:call_interrupted",
  threadId: "thr_bj3p5vk9py",
  turnId: "019de9bd-c299-7053-b11d-11b1f40e8b83",
  sourceSeqStart: 950,
  sourceSeqEnd: 951,
  startedAt: 1777743100000,
  createdAt: 1777743100200,
  status: "interrupted",
  callId: "call_interrupted",
  toolName: "notify_user",
  toolArgs: {
    text: "Got it. I’ve recorded this workflow and started the main Codex/GPT-5.5 xhigh worker in its own worktree to familiarize itself with the five change ranges before we process comments.\n\nI’ll wait for its readiness summary, then I’ll ask you for the first batch of 3–4 review comments and run the triage → fix/commit → review-check cycle you described.",
  },
  output: "",
  approvalStatus: null,
  activityIntents: [],
  durationMs: 200,
});

// Waiting for approval — ScheduleWakeup parked on the approval gate before
// the daemon ever scheduled it. Real arg shape, status=pending,
// approvalStatus=waiting_for_approval.
const waitingApprovalTool: TimelineRow = toolRow({
  id: "thr_4z2watgfgm:tool:toolu_waiting_approval",
  threadId: "thr_4z2watgfgm",
  turnId: "turn_b40752bbbd9145cb_1",
  sourceSeqStart: 960,
  sourceSeqEnd: 960,
  startedAt: 1777933900000,
  createdAt: 1777933900000,
  status: "pending",
  callId: "toolu_waiting_approval",
  toolName: "ScheduleWakeup",
  toolArgs: {
    delaySeconds: 90,
    reason: "checking on parallel review agents",
    prompt: "resume review synthesis once subagents return",
  },
  output: "",
  approvalStatus: "waiting_for_approval",
  activityIntents: [],
  durationMs: null,
});

// Denied — same ScheduleWakeup, but the user rejected the approval and the
// tool never ran.
const deniedTool: TimelineRow = toolRow({
  id: "thr_4z2watgfgm:tool:toolu_denied",
  threadId: "thr_4z2watgfgm",
  turnId: "turn_b40752bbbd9145cb_1",
  sourceSeqStart: 961,
  sourceSeqEnd: 961,
  startedAt: 1777933910000,
  createdAt: 1777933910000,
  status: "completed",
  callId: "toolu_denied",
  toolName: "ScheduleWakeup",
  toolArgs: {
    delaySeconds: 90,
    reason: "checking on parallel review agents",
    prompt: "resume review synthesis once subagents return",
  },
  output: "",
  approvalStatus: "denied",
  activityIntents: [],
  durationMs: 500,
});

interface SkillReadToolArgs {
  idSuffix: string;
  sequenceOffset: number;
  skillName: string;
  skillPath: string;
}

interface SkillReadStoryState {
  hint: string;
  label: string;
  row: TimelineRow;
}

function createSkillReadTool(args: SkillReadToolArgs): TimelineRow {
  return toolRow({
    id: `thr_skill_read:tool:toolu_skill_read_${args.idSuffix}`,
    threadId: "thr_skill_read",
    turnId: "turn_skill_read_1",
    sourceSeqStart: 970 + args.sequenceOffset,
    sourceSeqEnd: 971 + args.sequenceOffset,
    startedAt: 1777933920000 + args.sequenceOffset,
    createdAt: 1777933920000 + args.sequenceOffset,
    status: "completed",
    callId: `toolu_skill_read_${args.idSuffix}`,
    toolName: "Read",
    toolArgs: {
      file_path: args.skillPath,
    },
    output: `---\nname: ${args.skillName}\ndescription: ${args.skillName} skill instructions.\n---\n`,
    approvalStatus: null,
    activityIntents: [
      {
        type: "read",
        command: "Read",
        name: "SKILL.md",
        path: args.skillPath,
      },
    ],
    durationMs: 130,
  });
}

const projectClaudeSkillReadTool = createSkillReadTool({
  idSuffix: "project_claude",
  sequenceOffset: 0,
  skillName: "moss-hardening-review",
  skillPath:
    "/Users/brsbl/Code/bb/.claude/skills/moss-hardening-review/SKILL.md",
});

const userClaudeSymlinkSkillReadTool = createSkillReadTool({
  idSuffix: "user_claude_symlink",
  sequenceOffset: 2,
  skillName: "personal-review",
  skillPath: "/Users/brsbl/.claude/skills/personal-review/SKILL.md",
});

const projectCodexSkillReadTool = createSkillReadTool({
  idSuffix: "project_codex",
  sequenceOffset: 4,
  skillName: "workspace-tools",
  skillPath: "/Users/brsbl/Code/bb/.codex/skills/workspace-tools/SKILL.md",
});

const userCodexSkillReadTool = createSkillReadTool({
  idSuffix: "user_codex",
  sequenceOffset: 6,
  skillName: "html-previews",
  skillPath: "/Users/brsbl/.codex/skills/html-previews/SKILL.md",
});

const codexSystemSkillReadTool = createSkillReadTool({
  idSuffix: "codex_system",
  sequenceOffset: 8,
  skillName: "openai-docs",
  skillPath: "/Users/brsbl/.codex/skills/.system/openai-docs/SKILL.md",
});

const codexPluginNestedSkillReadTool = createSkillReadTool({
  idSuffix: "codex_plugin_nested",
  sequenceOffset: 10,
  skillName: "control-in-app-browser",
  skillPath:
    "/Users/brsbl/.codex/plugins/cache/openai-bundled/browser/26.608.12217/skills/control-in-app-browser/SKILL.md",
});

const claudePluginNestedSkillReadTool = createSkillReadTool({
  idSuffix: "claude_plugin_nested",
  sequenceOffset: 12,
  skillName: "frontend-design",
  skillPath:
    "/Users/brsbl/.claude/plugins/cache/claude-plugins-official/frontend-design/bd7cf41fc8a4/skills/frontend-design/SKILL.md",
});

const pluginRootSkillReadTool = createSkillReadTool({
  idSuffix: "plugin_root",
  sequenceOffset: 14,
  skillName: "browser",
  skillPath:
    "/Users/brsbl/.codex/plugins/cache/openai-bundled/browser/26.608.12217/SKILL.md",
});

const skillReadStoryStates: SkillReadStoryState[] = [
  {
    label: "Project Claude skill",
    hint: ".claude/skills/<skill>/SKILL.md",
    row: projectClaudeSkillReadTool,
  },
  {
    label: "User Claude skill",
    hint: "personal install path, including symlinked entries",
    row: userClaudeSymlinkSkillReadTool,
  },
  {
    label: "Project Codex skill",
    hint: ".codex/skills/<skill>/SKILL.md",
    row: projectCodexSkillReadTool,
  },
  {
    label: "User Codex skill",
    hint: "$CODEX_HOME/skills/<skill>/SKILL.md",
    row: userCodexSkillReadTool,
  },
  {
    label: "Codex system skill",
    hint: "$CODEX_HOME/skills/.system/<skill>/SKILL.md",
    row: codexSystemSkillReadTool,
  },
  {
    label: "Codex plugin skill",
    hint: "plugins/cache/<market>/<plugin>/<version>/skills/<skill>/SKILL.md",
    row: codexPluginNestedSkillReadTool,
  },
  {
    label: "Claude plugin skill",
    hint: "plugins/cache/<market>/<plugin>/<version>/skills/<skill>/SKILL.md",
    row: claudePluginNestedSkillReadTool,
  },
  {
    label: "Plugin root skill",
    hint: "plugins/cache/<market>/<plugin>/<version>/SKILL.md",
    row: pluginRootSkillReadTool,
  },
];

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="ToolSearch"
        hint="completed, scalar args, one-line match result"
      >
        <TimelineStage>
          <ThreadTimelineRows
            {...baseProps}
            initialExpanded={new Set([toolSearchTool.id])}
            timelineRows={[toolSearchTool]}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="notify_user — short"
        hint="single multi-line text arg, exercises the Show more overlay"
      >
        <TimelineStage>
          <ThreadTimelineRows
            {...baseProps}
            initialExpanded={new Set([notifyUserShort.id])}
            timelineRows={[notifyUserShort]}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="notify_user — long"
        hint="long markdown arg renders inside the row body"
      >
        <TimelineStage>
          <ThreadTimelineRows
            {...baseProps}
            initialExpanded={new Set([notifyUserLong.id])}
            timelineRows={[notifyUserLong]}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="running"
        hint="status=pending, output empty, completedAt null"
      >
        <TimelineStage>
          <ThreadTimelineRows {...baseProps} timelineRows={[runningTool]} />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="error"
        hint="status=error, real toolArgs, error result string"
      >
        <TimelineStage>
          <ThreadTimelineRows {...baseProps} timelineRows={[errorTool]} />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="waiting for approval"
        hint="approvalStatus=waiting_for_approval, parked before execution"
      >
        <TimelineStage>
          <ThreadTimelineRows
            {...baseProps}
            timelineRows={[waitingApprovalTool]}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="interrupted"
        hint="status=interrupted, user steered before tool returned"
      >
        <TimelineStage>
          <ThreadTimelineRows {...baseProps} timelineRows={[interruptedTool]} />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="denied"
        hint="approvalStatus=denied, user rejected the approval request"
      >
        <TimelineStage>
          <ThreadTimelineRows {...baseProps} timelineRows={[deniedTool]} />
        </TimelineStage>
      </StoryRow>
    </StoryCard>
  );
}

export function SkillReads() {
  return (
    <StoryCard labelWidth="260px">
      {skillReadStoryStates.map((state) => (
        <StoryRow key={state.row.id} label={state.label} hint={state.hint}>
          <TimelineStage>
            <ThreadTimelineRows {...baseProps} timelineRows={[state.row]} />
          </TimelineStage>
        </StoryRow>
      ))}
    </StoryCard>
  );
}
