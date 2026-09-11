import type { ContextSnapshot } from "@bb/domain";
import type { ThreadContextWindowUsage } from "@bb/server-contract";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import {
  ThreadContextWindowCard,
  ThreadContextWindowIndicator,
} from "./ThreadContextWindowIndicator";

export default {
  title: "thread/timeline/Context window indicator",
};

const WINDOW = 200_000;

function usage(
  usedTokens: number,
  estimated = false,
): ThreadContextWindowUsage {
  return { usedTokens, modelContextWindow: WINDOW, estimated };
}

const low = usage(36_000);
const moderate = usage(110_000);
const approachingLimit = usage(166_000);
const critical = usage(192_000);
const estimated = usage(150_000, true);

function UsageCardRow({
  label,
  hint,
  usage: u,
}: {
  label: string;
  hint: string;
  usage: ThreadContextWindowUsage;
}) {
  return (
    <StoryRow
      label={label}
      hint={hint}
      className="max-md:grid-cols-1 max-md:gap-y-3"
    >
      <ThreadContextWindowCard
        detailsEnabled
        usage={u}
        className="max-w-full max-md:w-80"
      />
    </StoryRow>
  );
}

const claudeSnapshot: ContextSnapshot = {
  capturedAt: "2026-09-11T12:00:00.000Z",
  providerSessionId: "storybook-claude",
  providerTurnId: null,
  model: "claude-sonnet",
  usedTokens: 80_000,
  contextWindowTokens: 258_000,
  autoCompactAtTokens: 218_000,
  estimated: false,
  categories: [
    {
      id: "messages",
      label: "Messages",
      tokens: 52_700,
      kind: "used",
      entries: [
        { id: "Tool results", label: "Tool results", tokens: 35_580 },
        {
          id: "Assistant messages",
          label: "Assistant messages",
          tokens: 7_000,
        },
        { id: "User messages", label: "User messages", tokens: 5_400 },
        { id: "Tool calls", label: "Tool calls", tokens: 2_100 },
        { id: "Attachments", label: "Attachments", tokens: 1_700 },
        { id: "Unattributed", label: "Unattributed", tokens: 920 },
      ],
    },
    {
      id: "system",
      label: "System prompt",
      tokens: 6_120,
      kind: "used",
      entries: [
        { id: "Core instructions", label: "Core instructions", tokens: 4_380 },
        {
          id: "Environment and session",
          label: "Environment and session",
          tokens: 1_740,
        },
      ],
    },
    {
      id: "tools",
      label: "Built-in tools",
      tokens: 10_940,
      kind: "used",
      entries: [
        { id: "Bash", label: "Bash", tokens: 3_120 },
        { id: "Read", label: "Read", tokens: 2_340 },
        { id: "Edit", label: "Edit", tokens: 2_160 },
        { id: "Grep", label: "Grep", tokens: 1_840 },
        { id: "Glob", label: "Glob", tokens: 1_480 },
      ],
    },
    {
      id: "mcp",
      label: "MCP tools",
      tokens: 3_680,
      kind: "used",
      entries: [
        {
          id: "bb · thread_inspect",
          label: "bb · thread_inspect",
          tokens: 1_460,
        },
        { id: "bb · thread_list", label: "bb · thread_list", tokens: 980 },
        { id: "bb · read_skill", label: "bb · read_skill", tokens: 1_240 },
      ],
    },
    {
      id: "memory",
      label: "Memory files",
      tokens: 4_310,
      kind: "used",
      entries: [
        {
          id: "~/.claude/CLAUDE.md",
          label: "~/.claude/CLAUDE.md",
          tokens: 840,
        },
        { id: "CLAUDE.md", label: "CLAUDE.md", tokens: 2_470 },
        {
          id: ".claude/rules/testing.md",
          label: ".claude/rules/testing.md",
          tokens: 1_000,
        },
      ],
    },
    {
      id: "skills",
      label: "Skill descriptions",
      tokens: 1_250,
      kind: "used",
      entries: [
        { id: "verify-bb", label: "verify-bb", tokens: 540 },
        { id: "repo-research", label: "repo-research", tokens: 420 },
        { id: "deslop", label: "deslop", tokens: 290 },
      ],
    },
    {
      id: "agents",
      label: "Agent definitions",
      tokens: 1_000,
      kind: "used",
      entries: [
        { id: "code-reviewer", label: "code-reviewer", tokens: 620 },
        { id: "test-runner", label: "test-runner", tokens: 380 },
      ],
    },
    {
      id: "free",
      label: "Free space",
      tokens: 138_000,
      kind: "free",
      entries: [],
    },
    {
      id: "reserve",
      label: "Compaction reserve",
      tokens: 40_000,
      kind: "reserved",
      entries: [],
    },
    {
      id: "deferred",
      label: "Deferred tools",
      tokens: 18_460,
      kind: "deferred",
      entries: [
        { id: "GitHub · 12 tools", label: "GitHub · 12 tools", tokens: 10_820 },
        { id: "Linear · 8 tools", label: "Linear · 8 tools", tokens: 5_540 },
        {
          id: "Built-in · 4 tools",
          label: "Built-in · 4 tools",
          tokens: 2_100,
        },
      ],
    },
  ],
};

const indicatorVariants = [
  { label: "Low", percent: "18%", usage: low },
  { label: "Moderate", percent: "55%", usage: moderate },
  { label: "Approaching limit", percent: "83%", usage: approachingLimit },
  { label: "Critical", percent: "96%", usage: critical },
  { label: "Estimated", percent: "75%", usage: estimated },
];

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Usage indicators"
        hint="Hover a ring to see its context window."
        className="max-md:grid-cols-1 max-md:gap-y-3"
      >
        <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
          {indicatorVariants.map((variant) => (
            <div
              key={variant.label}
              className="flex flex-col items-center gap-1"
            >
              <ThreadContextWindowIndicator usage={variant.usage} />
              <span className="text-xs text-muted-foreground">
                {variant.label}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {variant.percent}
              </span>
            </div>
          ))}
        </div>
      </StoryRow>
      <StoryRow
        label="Optional context breakdown"
        hint="Claude sample data. The card grows upward from the bottom-right corner; the toggle stays under the pointer."
        className="max-md:grid-cols-1 max-md:gap-y-3"
      >
        <div className="flex h-[42rem] w-full items-end justify-end overflow-hidden rounded-lg border border-border-hairline bg-surface-recessed p-3">
          <ThreadContextWindowCard
            detailsEnabled
            usage={{
              usedTokens: claudeSnapshot.usedTokens,
              modelContextWindow: claudeSnapshot.contextWindowTokens,
              estimated: claudeSnapshot.estimated,
              snapshot: claudeSnapshot,
            }}
            className="max-w-full max-md:w-80"
          />
        </div>
      </StoryRow>
      <UsageCardRow
        label="Usage menu — approaching (83%)"
        hint="Warning tone"
        usage={approachingLimit}
      />
      <UsageCardRow
        label="Usage menu — critical (96%)"
        hint="Destructive tone"
        usage={critical}
      />
      <UsageCardRow
        label="Usage menu — estimated (75%)"
        hint='Header reads "Estimated context"'
        usage={estimated}
      />
    </StoryCard>
  );
}
