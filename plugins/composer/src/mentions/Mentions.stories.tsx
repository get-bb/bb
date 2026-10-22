import type { ReactNode } from "react";
import type {
  ExperimentalComposerCommandSuggestion,
  ExperimentalComposerMentionSuggestion,
  ExperimentalComposerThreadRelation,
} from "@get-bb/plugin-sdk/app";
import { MentionMenu } from "./MentionMenu";
import type {
  CommandMenuState,
  MenuMentionGroup,
  MentionMenuState,
  TypeaheadMenuState,
} from "./typeahead-suggestions";

export default {
  title: "plugins/Composer/Mentions",
};

const noop = () => {};

function StoryRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[210px_minmax(0,1fr)] gap-x-4">
      <div className="flex flex-col pt-1 text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">{hint}</span>
      </div>
      <div className="w-full max-w-[760px]">{children}</div>
    </div>
  );
}

function StoryCard({ children }: { children: ReactNode }) {
  return <div className="m-6 flex flex-col gap-4">{children}</div>;
}

function pathSuggestion(
  path: string,
  source: "workspace" | "thread-storage",
  entryKind: "file" | "directory",
): ExperimentalComposerMentionSuggestion {
  const qualified =
    source === "thread-storage" ? `thread-storage:${path}` : path;
  return {
    kind: "path",
    key: JSON.stringify(["path", source, entryKind, path]),
    text: entryKind === "directory" ? `${qualified}/` : qualified,
    mention: {
      kind: "path",
      source,
      entryKind,
      path,
      label: path.split("/").at(-1) ?? path,
    },
  };
}

function threadSuggestion({
  threadId,
  title,
  projectId = "proj_bb",
  projectName = null,
  relation = null,
}: {
  threadId: string;
  title: string | null;
  projectId?: string;
  projectName?: string | null;
  relation?: ExperimentalComposerThreadRelation | null;
}): ExperimentalComposerMentionSuggestion {
  return {
    kind: "thread",
    key: JSON.stringify(["thread", threadId]),
    text: `thread:${threadId}`,
    mention: { kind: "thread", threadId, projectId, label: title ?? threadId },
    title,
    projectName,
    relation,
  };
}

function pluginSuggestion(
  pluginId: string,
  provider: string,
  providerLabel: string,
  id: string,
  title: string,
  subtitle: string | null,
): ExperimentalComposerMentionSuggestion {
  return {
    kind: "plugin",
    key: JSON.stringify(["plugin", pluginId, provider, id]),
    text: title,
    mention: {
      kind: "plugin",
      pluginId,
      provider,
      id,
      label: title,
      icon: null,
    },
    providerLabel,
    subtitle,
  };
}

const pathSuggestions = [
  pathSuggestion(
    "plugins/composer/src/PromptBoxInternal.tsx",
    "workspace",
    "file",
  ),
  pathSuggestion(
    "apps/app/src/components/promptbox/banner/ContextBanner.tsx",
    "workspace",
    "file",
  ),
  pathSuggestion(
    "apps/app/src/components/promptbox/mentions",
    "workspace",
    "directory",
  ),
  pathSuggestion("notes/status.md", "thread-storage", "file"),
  pathSuggestion("scratch/reports", "thread-storage", "directory"),
];

const threadSuggestions = [
  threadSuggestion({
    threadId: "thr_qfk8ksbxkk",
    title: "Wire up promptbox stories and trim FollowUp API",
  }),
  threadSuggestion({
    threadId: "thr_mgr_kj4n2x",
    title: "Parent: app/timeline cleanup sprint",
  }),
  threadSuggestion({
    threadId: "thr_untitled_3",
    title: null,
    projectId: "proj_docs",
    projectName: "Docs Site",
  }),
];

const relatedThreadSuggestions = [
  threadSuggestion({
    threadId: "thr_parent_9dk2",
    title: "Explain issue 3694",
    relation: "parent",
  }),
  threadSuggestion({
    threadId: "thr_child_7fq1",
    title: "Review exchange for concerns",
    relation: "child",
  }),
  threadSuggestion({
    threadId: "thr_sibling_2xm8",
    title: "Explain issue 3964 opus",
    relation: "same-parent",
  }),
  threadSuggestion({
    threadId: "thr_roommate_5te3",
    title: "Explain branch behavior",
    relation: "same-environment",
  }),
  threadSuggestion({
    threadId: "thr_unrelated_4bd6",
    title: "Explain deploy flow",
    projectId: "proj_docs",
    projectName: "Docs Site",
  }),
];

const longRelatedThreadSuggestions = [
  threadSuggestion({
    threadId: "thr_long_title",
    title:
      "Reconcile daemon turns the server lost track of on an explicit stop request",
    relation: "same-environment",
  }),
  threadSuggestion({
    threadId: "thr_long_project",
    title: "Correlate Codex turn dispatches with the named turn",
    projectId: "proj_docs",
    projectName: "Documentation And Marketing Site",
    relation: "same-parent",
  }),
];

const longPathSuggestions = [
  pathSuggestion(
    "apps/server/src/routes/internal/long/path/that/keeps/going/and/going/threads.ts",
    "workspace",
    "file",
  ),
  pathSuggestion(
    "packages/agent-providers/src/codex/internal/long/nested/module/streaming/event-decoder.ts",
    "workspace",
    "file",
  ),
];

const pluginMentionSuggestions = [
  pluginSuggestion(
    "linear",
    "issues",
    "Linear issues",
    "ISS-42",
    "Fix login bug",
    "In progress",
  ),
  pluginSuggestion(
    "linear",
    "issues",
    "Linear issues",
    "ISS-51",
    "Ship mention providers end-to-end",
    "Todo",
  ),
  pluginSuggestion(
    "linear",
    "docs",
    "Linear docs",
    "onboarding",
    "Onboarding guide",
    null,
  ),
  pluginSuggestion(
    "linear-mirror",
    "issues",
    "Linear issues",
    "MIR-7",
    "Mirrored triage sweep",
    "Mirror",
  ),
];

function command(
  name: string,
  source: ExperimentalComposerCommandSuggestion["source"],
  origin: ExperimentalComposerCommandSuggestion["origin"],
  description: string | null,
  argumentHint: string | null,
): ExperimentalComposerCommandSuggestion {
  return { kind: "command", name, source, origin, description, argumentHint };
}

const commandState: CommandMenuState = {
  kind: "results",
  refreshing: false,
  groups: [
    {
      key: "skill",
      label: "Skills",
      suggestions: [
        command(
          "moss-hardening-review",
          "skill",
          "user",
          "Run a hardening review for Moss persistence paths",
          "[branch | staged] [base=<ref>]",
        ),
        command(
          "github:gh-fix-ci",
          "skill",
          "user",
          "Debug failing GitHub Actions checks",
          null,
        ),
      ],
    },
    {
      key: "project-command",
      label: "Project commands",
      suggestions: [
        command(
          "frontend:component",
          "command",
          "project",
          "Create or update a project component",
          "$ARGUMENTS",
        ),
      ],
    },
    {
      key: "user-command",
      label: "User commands",
      suggestions: [
        command(
          "review",
          "command",
          "user",
          "Review local changes",
          "[target]",
        ),
      ],
    },
  ],
};

const longCommandState: CommandMenuState = {
  kind: "results",
  refreshing: false,
  groups: [
    {
      key: "skill",
      label: "Skills",
      suggestions: [
        command(
          "moss-skills:moss-formulas-variables",
          "skill",
          "user",
          "Create or edit Moss formulas and variables, including anchors, derived values, and table-cell usage",
          "<note-path> [--fix]",
        ),
      ],
    },
    {
      key: "project-command",
      label: "Project commands",
      suggestions: [
        command(
          "project-super-long-command-name-for-regression-coverage",
          "command",
          "project",
          "Exercise truncation when a command name and description are both too long for the menu row",
          "<very-long-argument-placeholder>",
        ),
      ],
    },
  ],
};

function groupLabel(
  item: ExperimentalComposerMentionSuggestion,
): [string, string] {
  if (item.kind === "thread") return ["threads", "Threads"];
  if (item.kind === "project") return ["projects", "Projects"];
  if (item.kind === "section") return ["sections", "Sections"];
  if (item.kind === "plugin") {
    return [
      `plugin:${item.mention.pluginId}:${item.mention.provider}`,
      item.providerLabel,
    ];
  }
  return item.mention.source === "thread-storage"
    ? ["path:thread-storage", "Thread storage"]
    : ["path:workspace", "Workspace"];
}

function resultsState(
  suggestions: readonly ExperimentalComposerMentionSuggestion[],
): MentionMenuState {
  const groups = new Map<
    string,
    MenuMentionGroup & { suggestions: ExperimentalComposerMentionSuggestion[] }
  >();
  for (const suggestion of suggestions) {
    const [key, label] = groupLabel(suggestion);
    const group = groups.get(key);
    if (group) group.suggestions.push(suggestion);
    else groups.set(key, { key, label, suggestions: [suggestion] });
  }
  return { kind: "results", refreshing: false, groups: [...groups.values()] };
}

function Row({
  state,
  selectedIndex = 0,
}: {
  state: TypeaheadMenuState;
  selectedIndex?: number;
}) {
  return (
    <MentionMenu state={state} selectedIndex={selectedIndex} onApply={noop} />
  );
}

function MentionRow({
  state,
  selectedIndex,
}: {
  state: MentionMenuState;
  selectedIndex?: number;
}) {
  return (
    <Row state={{ trigger: "mention", state }} selectedIndex={selectedIndex} />
  );
}

function CommandRow({
  state,
  selectedIndex,
}: {
  state: CommandMenuState;
  selectedIndex?: number;
}) {
  return (
    <Row
      state={{ trigger: "command", char: "/", state }}
      selectedIndex={selectedIndex}
    />
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
        <MentionRow state={resultsState([])} />
      </StoryRow>
      <StoryRow label="path matches" hint="workspace and thread storage paths">
        <MentionRow state={resultsState(pathSuggestions)} />
      </StoryRow>
      <StoryRow
        label="path matches (selected index)"
        hint="third item highlighted (keyboard arrow nav)"
      >
        <MentionRow state={resultsState(pathSuggestions)} selectedIndex={2} />
      </StoryRow>
      <StoryRow
        label="thread matches"
        hint="parent and root threads; cross-project rows include project"
      >
        <MentionRow state={resultsState(threadSuggestions)} />
      </StoryRow>
      <StoryRow
        label="thread relations"
        hint="relation pill: parent, child thread, same parent, same environment; unrelated rows keep only a project name"
      >
        <MentionRow state={resultsState(relatedThreadSuggestions)} />
      </StoryRow>
      <StoryRow
        label="thread relations (long titles)"
        hint="title truncates before the relation pill; pill never shrinks"
      >
        <MentionRow state={resultsState(longRelatedThreadSuggestions)} />
      </StoryRow>
      <StoryRow label="mixed path + thread" hint="threads first">
        <MentionRow
          state={resultsState([
            ...threadSuggestions.slice(0, 2),
            ...pathSuggestions.slice(0, 4),
          ])}
        />
      </StoryRow>
      <StoryRow
        label="plugin provider sections"
        hint="each mention provider groups under its own label after the built-in sources"
      >
        <MentionRow
          state={resultsState([
            ...threadSuggestions.slice(0, 1),
            ...pathSuggestions.slice(0, 2),
            ...pluginMentionSuggestions,
          ])}
          selectedIndex={3}
        />
      </StoryRow>
      <StoryRow
        label="plugin-only matches"
        hint="a query that only plugin providers answer"
      >
        <MentionRow state={resultsState(pluginMentionSuggestions)} />
      </StoryRow>
      <StoryRow
        label="long path truncation"
        hint="TruncateStart on directory; basename stays visible"
      >
        <MentionRow state={resultsState(longPathSuggestions)} />
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
        <CommandRow state={commandState} />
      </StoryRow>
      <StoryRow
        label="long command truncation"
        hint="long skill names, descriptions, and hints stay inside the menu"
      >
        <CommandRow state={longCommandState} />
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
  suggestions: readonly ExperimentalComposerMentionSuggestion[];
  width: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div style={{ width }}>
        <MentionRow state={resultsState(suggestions)} />
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
