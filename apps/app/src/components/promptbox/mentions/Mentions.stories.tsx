import { MentionMenu } from "@/components/promptbox/mentions/MentionMenu";
import type {
  CommandMenuState,
  MentionMenuState,
  ProviderCommandSuggestion,
  PromptMentionSuggestion,
  TypeaheadMenuState,
} from "@bb/client-core";
import { orderPromptMentionSuggestions } from "@/hooks/promptMentionCandidates";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";

export default {
  title: "promptbox/Mentions",
};

const noop = () => {};

function PromptStage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

function getPathName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function workspaceFile(path: string): PromptMentionSuggestion {
  return {
    kind: "path",
    source: "workspace",
    entryKind: "file",
    path,
    name: getPathName(path),
    replacement: path,
  };
}

function workspaceFolder(path: string): PromptMentionSuggestion {
  return {
    kind: "path",
    source: "workspace",
    entryKind: "directory",
    path,
    name: getPathName(path),
    replacement: `${path}/`,
  };
}

function storageFile(path: string): PromptMentionSuggestion {
  return {
    kind: "path",
    source: "thread-storage",
    entryKind: "file",
    path,
    name: getPathName(path),
    replacement: `thread-storage:${path}`,
  };
}

function storageFolder(path: string): PromptMentionSuggestion {
  return {
    kind: "path",
    source: "thread-storage",
    entryKind: "directory",
    path,
    name: getPathName(path),
    replacement: `thread-storage:${path}/`,
  };
}

const pathSuggestions: PromptMentionSuggestion[] = [
  workspaceFile("apps/app/src/components/promptbox/PromptBoxInternal.tsx"),
  workspaceFile("apps/app/src/components/promptbox/banner/ContextBanner.tsx"),
  workspaceFolder("apps/app/src/components/promptbox/mentions"),
  storageFile("notes/status.md"),
  storageFolder("scratch/reports"),
];

const threadSuggestions: PromptMentionSuggestion[] = [
  {
    kind: "thread",
    path: "thread:thr_qfk8ksbxkk",
    replacement: "thread:thr_qfk8ksbxkk",
    projectId: "proj_bb",
    threadId: "thr_qfk8ksbxkk",
    title: "Wire up promptbox stories and trim FollowUp API",
    relation: null,
  },
  {
    kind: "thread",
    path: "thread:thr_mgr_kj4n2x",
    replacement: "thread:thr_mgr_kj4n2x",
    projectId: "proj_bb",
    threadId: "thr_mgr_kj4n2x",
    title: "Parent: app/timeline cleanup sprint",
    relation: null,
  },
  {
    kind: "thread",
    path: "thread:thr_untitled_3",
    replacement: "thread:thr_untitled_3",
    projectId: "proj_docs",
    projectName: "Docs Site",
    threadId: "thr_untitled_3",
    title: undefined,
    relation: null,
  },
];

const relatedThreadSuggestions: PromptMentionSuggestion[] = [
  {
    kind: "thread",
    path: "thread:thr_parent_9dk2",
    replacement: "thread:thr_parent_9dk2",
    projectId: "proj_bb",
    threadId: "thr_parent_9dk2",
    title: "Explain issue 3694",
    relation: "parent",
  },
  {
    kind: "thread",
    path: "thread:thr_child_7fq1",
    replacement: "thread:thr_child_7fq1",
    projectId: "proj_bb",
    threadId: "thr_child_7fq1",
    title: "Review exchange for concerns",
    relation: "child",
  },
  {
    kind: "thread",
    path: "thread:thr_sibling_2xm8",
    replacement: "thread:thr_sibling_2xm8",
    projectId: "proj_bb",
    threadId: "thr_sibling_2xm8",
    title: "Explain issue 3964 opus",
    relation: "same-parent",
  },
  {
    kind: "thread",
    path: "thread:thr_roommate_5te3",
    replacement: "thread:thr_roommate_5te3",
    projectId: "proj_bb",
    threadId: "thr_roommate_5te3",
    title: "Explain branch behavior",
    relation: "same-environment",
  },
  {
    kind: "thread",
    path: "thread:thr_unrelated_4bd6",
    replacement: "thread:thr_unrelated_4bd6",
    projectId: "proj_docs",
    projectName: "Docs Site",
    threadId: "thr_unrelated_4bd6",
    title: "Explain deploy flow",
    relation: null,
  },
];

const longRelatedThreadSuggestions: PromptMentionSuggestion[] = [
  {
    kind: "thread",
    path: "thread:thr_long_title",
    replacement: "thread:thr_long_title",
    projectId: "proj_bb",
    threadId: "thr_long_title",
    title:
      "Reconcile daemon turns the server lost track of on an explicit stop request",
    relation: "same-environment",
  },
  {
    kind: "thread",
    path: "thread:thr_long_project",
    replacement: "thread:thr_long_project",
    projectId: "proj_docs",
    projectName: "Documentation And Marketing Site",
    threadId: "thr_long_project",
    title: "Correlate Codex turn dispatches with the named turn",
    relation: "same-parent",
  },
];

const longPathSuggestions: PromptMentionSuggestion[] = [
  workspaceFile(
    "apps/server/src/routes/internal/long/path/that/keeps/going/and/going/threads.ts",
  ),
  workspaceFile(
    "packages/agent-providers/src/codex/internal/long/nested/module/streaming/event-decoder.ts",
  ),
];

const mixedSuggestions: PromptMentionSuggestion[] = [
  ...threadSuggestions.slice(0, 2),
  ...pathSuggestions.slice(0, 4),
];

const commandSuggestions: ProviderCommandSuggestion[] = [
  {
    kind: "command",
    name: "moss-hardening-review",
    source: "skill",
    origin: "user",
    description: "Run a hardening review for Moss persistence paths",
    argumentHint: "[branch | staged] [base=<ref>]",
  },
  {
    kind: "command",
    name: "github:gh-fix-ci",
    source: "skill",
    origin: "user",
    description: "Debug failing GitHub Actions checks",
    argumentHint: null,
  },
  {
    kind: "command",
    name: "frontend:component",
    source: "command",
    origin: "project",
    description: "Create or update a project component",
    argumentHint: "$ARGUMENTS",
  },
  {
    kind: "command",
    name: "review",
    source: "command",
    origin: "user",
    description: "Review local changes",
    argumentHint: "[target]",
  },
];

const longCommandSuggestions: ProviderCommandSuggestion[] = [
  {
    kind: "command",
    name: "moss-skills:moss-formulas-variables",
    source: "skill",
    origin: "user",
    description:
      "Create or edit Moss formulas and variables, including anchors, derived values, and table-cell usage",
    argumentHint: "<note-path> [--fix]",
  },
  {
    kind: "command",
    name: "project-super-long-command-name-for-regression-coverage",
    source: "command",
    origin: "project",
    description:
      "Exercise truncation when a command name and description are both too long for the menu row",
    argumentHint: "<very-long-argument-placeholder>",
  },
];

const pluginMentionSuggestions: PromptMentionSuggestion[] = [
  {
    kind: "plugin",
    pluginId: "linear",
    providerId: "issues",
    itemId: "issues:ISS-42",
    providerLabel: "Linear issues",
    title: "Fix login bug",
    subtitle: "In progress",
    icon: null,
    replacement: "Fix login bug",
  },
  {
    kind: "plugin",
    pluginId: "linear",
    providerId: "issues",
    itemId: "issues:ISS-51",
    providerLabel: "Linear issues",
    title: "Ship mention providers end-to-end",
    subtitle: "Todo",
    icon: null,
    replacement: "Ship mention providers end-to-end",
  },
  {
    kind: "plugin",
    pluginId: "linear",
    providerId: "docs",
    itemId: "docs:onboarding",
    providerLabel: "Linear docs",
    title: "Onboarding guide",
    subtitle: null,
    icon: null,
    replacement: "Onboarding guide",
  },
  {
    kind: "plugin",
    pluginId: "linear-mirror",
    providerId: "issues",
    itemId: "issues:MIR-7",
    providerLabel: "Linear issues",
    title: "Mirrored triage sweep",
    subtitle: "Mirror",
    icon: null,
    replacement: "Mirrored triage sweep",
  },
];

const mixedWithPluginSuggestions: PromptMentionSuggestion[] = [
  ...threadSuggestions.slice(0, 1),
  ...pathSuggestions.slice(0, 2),
  ...pluginMentionSuggestions,
];

interface RowConfig {
  state: TypeaheadMenuState;
  selectedIndex?: number;
}

interface ResultsStateConfig {
  suggestions: readonly PromptMentionSuggestion[];
}

function makeResultsState(args: ResultsStateConfig): MentionMenuState {
  return {
    kind: "results",
    results: orderPromptMentionSuggestions({
      query: "",
      suggestions: args.suggestions,
    }),
  };
}

function Row({ state, selectedIndex = 0 }: RowConfig) {
  return (
    <PromptStage>
      <MentionMenu state={state} selectedIndex={selectedIndex} onApply={noop} />
    </PromptStage>
  );
}

function MentionRow({
  state,
  selectedIndex = 0,
}: {
  state: MentionMenuState;
  selectedIndex?: number;
}) {
  return (
    <Row state={{ trigger: "mention", state }} selectedIndex={selectedIndex} />
  );
}

function makeCommandResultsState(
  suggestions: readonly ProviderCommandSuggestion[],
): CommandMenuState {
  return {
    kind: "results",
    suggestions,
  };
}

function CommandRow({
  state,
  selectedIndex = 0,
}: {
  state: CommandMenuState;
  selectedIndex?: number;
}) {
  return (
    <Row state={{ trigger: "command", state }} selectedIndex={selectedIndex} />
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="hint" hint='@ typed alone — "Type to search mentions"'>
        <MentionRow state={{ kind: "hint" }} />
      </StoryRow>
      <StoryRow label="loading" hint="suggestions fetching">
        <MentionRow state={{ kind: "loading" }} />
      </StoryRow>
      <StoryRow label="error" hint="suggestion query failed">
        <MentionRow state={{ kind: "error" }} />
      </StoryRow>
      <StoryRow label="no matches" hint="query returned zero results">
        <MentionRow state={makeResultsState({ suggestions: [] })} />
      </StoryRow>
      <StoryRow label="path matches" hint="workspace and thread storage paths">
        <MentionRow
          state={makeResultsState({ suggestions: pathSuggestions })}
        />
      </StoryRow>
      <StoryRow
        label="path matches (selected index)"
        hint="third item highlighted (keyboard arrow nav)"
      >
        <MentionRow
          state={makeResultsState({ suggestions: pathSuggestions })}
          selectedIndex={2}
        />
      </StoryRow>
      <StoryRow
        label="thread matches"
        hint="parent and root threads; cross-project rows include project"
      >
        <MentionRow
          state={makeResultsState({ suggestions: threadSuggestions })}
        />
      </StoryRow>
      <StoryRow
        label="thread relations"
        hint="relation pill: parent, child, same parent, same environment; unrelated rows keep only a project name"
      >
        <MentionRow
          state={makeResultsState({ suggestions: relatedThreadSuggestions })}
        />
      </StoryRow>
      <StoryRow
        label="thread relations (long titles)"
        hint="title truncates before the relation pill; pill never shrinks"
      >
        <MentionRow
          state={makeResultsState({
            suggestions: longRelatedThreadSuggestions,
          })}
        />
      </StoryRow>
      <StoryRow
        label="mixed path + thread"
        hint="threads first (production order: usePromptMentions prepends threads)"
      >
        <MentionRow
          state={makeResultsState({ suggestions: mixedSuggestions })}
        />
      </StoryRow>
      <StoryRow
        label="plugin provider sections"
        hint="each mention provider groups under its own label after the built-in sources (design §4.9)"
      >
        <MentionRow
          state={makeResultsState({ suggestions: mixedWithPluginSuggestions })}
          selectedIndex={3}
        />
      </StoryRow>
      <StoryRow
        label="plugin-only matches"
        hint="a query that only plugin providers answer"
      >
        <MentionRow
          state={makeResultsState({ suggestions: pluginMentionSuggestions })}
        />
      </StoryRow>
      <StoryRow
        label="long path truncation"
        hint="TruncateStart on directory; basename stays visible"
      >
        <MentionRow
          state={makeResultsState({ suggestions: longPathSuggestions })}
        />
      </StoryRow>
      <StoryRow label="command loading" hint="$ or / command fetch in flight">
        <CommandRow state={{ kind: "loading" }} />
      </StoryRow>
      <StoryRow label="command error" hint="command query failed">
        <CommandRow state={{ kind: "error" }} />
      </StoryRow>
      <StoryRow
        label="command sections"
        hint="skills, project commands, and user commands share one flat nav order"
      >
        <CommandRow state={makeCommandResultsState(commandSuggestions)} />
      </StoryRow>
      <StoryRow
        label="skill arg hint selected"
        hint="skill row highlighted with description and argument hint"
      >
        <CommandRow
          state={makeCommandResultsState(commandSuggestions)}
          selectedIndex={0}
        />
      </StoryRow>
      <StoryRow
        label="long command truncation"
        hint="long skill names, descriptions, and hints stay inside the menu"
      >
        <CommandRow state={makeCommandResultsState(longCommandSuggestions)} />
      </StoryRow>
    </StoryCard>
  );
}

const MENTION_MENU_WIDTHS = [360, 480, 760] as const;

function WidthSample({
  label,
  suggestions,
  width,
}: {
  label: string;
  suggestions: PromptMentionSuggestion[];
  width: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div style={{ width }}>
        <MentionMenu
          state={{
            trigger: "mention",
            state: makeResultsState({ suggestions }),
          }}
          selectedIndex={0}
          onApply={noop}
        />
      </div>
    </div>
  );
}

export function ThreadRelationWidths() {
  return (
    <div className="flex flex-col gap-4 p-6">
      {MENTION_MENU_WIDTHS.map((width) => (
        <WidthSample
          key={width}
          label={`${width}px`}
          suggestions={relatedThreadSuggestions}
          width={width}
        />
      ))}
      <WidthSample
        label="360px · long titles"
        suggestions={longRelatedThreadSuggestions}
        width={360}
      />
      <WidthSample
        label="760px · long titles"
        suggestions={longRelatedThreadSuggestions}
        width={760}
      />
    </div>
  );
}
