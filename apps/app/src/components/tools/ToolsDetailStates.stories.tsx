import { useEffect, type CSSProperties, type ReactNode } from "react";
import { ResourceListState } from "@bb/shared-ui/resource-list";
import { AutomationDetailView } from "bb-plugin-automations/detail-view";
import type {
  AutomationResponse,
  AutomationRunResponse,
} from "bb-plugin-automations/rpc-types";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { PluginDetail } from "@/components/tools/PluginDetail";
import { SkillDetailView } from "@/components/tools/SkillDetailView";

/**
 * Every state each tool type's detail page can be in, rendered as the real
 * page. One story per tool type: scroll it and you have reviewed that type.
 *
 * These are the whole Tools story surface, deliberately. Anything a running
 * server would show you is better seen in the running app, and anything that
 * must not regress belongs in a test — `detail-page-recipes.test.tsx` pins
 * section order and labels, `SkillsView.test.tsx` and `ToolsSidebar.test.tsx`
 * pin routing. What is left, and what these cover, is the states a healthy
 * local server will not produce on demand: loading, missing, failed, empty,
 * and disabled — plus content ugly enough to break a layout.
 */
export default {
  title: "Tools/Detail states",
};

const noop = () => {};

function Story({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main
      className="mx-auto w-full max-w-[72rem] space-y-4 px-5 py-6"
      style={{ "--story-doc-width": "232px" } as CSSProperties}
    >
      <header>
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {description}
        </p>
      </header>
      <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
        <div className="grid grid-cols-[var(--story-doc-width)_minmax(0,1fr)] max-[900px]:hidden">
          <span className="flex flex-col border-r border-border bg-surface-recessed px-4 py-2">
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              State
            </span>
            <span className="text-2xs text-subtle-foreground">
              When it happens
            </span>
          </span>
          <span className="flex flex-col px-4 py-2">
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Rendered page
            </span>
            <span className="text-2xs text-subtle-foreground">
              The real component
            </span>
          </span>
        </div>
        {children}
      </div>
    </main>
  );
}

/**
 * One state: what it is on the left, the real page on the right. The caption
 * sticks while a tall page scrolls past it, so you never lose track of which
 * state you are looking at.
 */
function State({
  name,
  note,
  children,
}: {
  name: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className="grid grid-cols-[var(--story-doc-width)_minmax(0,1fr)] items-start max-[900px]:grid-cols-1">
      <div className="h-full border-r border-border bg-surface-recessed max-[900px]:border-b max-[900px]:border-r-0">
        <div className="sticky top-0 px-4 py-4">
          <h2 className="text-sm font-medium text-foreground">{name}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {note}
          </p>
        </div>
      </div>
      <div className="min-w-0 px-5 py-5">{children}</div>
    </section>
  );
}

// --- Skills -----------------------------------------------------------------

const SKILL_PATH = "/Users/you/.bb/skills/writing-voice/SKILL.md";

function Skill({
  files = [SKILL_PATH],
  contentState = {
    kind: "ready" as const,
    content:
      "# writing-voice\n\nLead with the answer. Cut hedging. Prefer short sentences.",
  },
  headerControl,
}: {
  files?: readonly string[];
  contentState?: Parameters<typeof SkillDetailView>[0]["contentState"];
  headerControl?: Parameters<typeof SkillDetailView>[0]["headerControl"];
}) {
  return (
    <SkillDetailView
      title="writing-voice"
      path={SKILL_PATH}
      files={files}
      selectedPath={files[0] ?? SKILL_PATH}
      onSelectFile={noop}
      contentState={contentState}
      headerControl={headerControl}
    />
  );
}

export function SkillStates() {
  return (
    <Story
      title="Skill detail states"
      description="A skill page is Files (only when there is more than one) then Definition. Everything else is a state of those two sections or of the route around them."
    >
      <State
        name="Single file"
        note="The common case: one SKILL.md, so no Files section is rendered."
      >
        <Skill />
      </State>

      <State
        name="Multiple files"
        note="Files appears above Definition and never below it."
      >
        <Skill
          files={[SKILL_PATH, "/Users/you/.bb/skills/writing-voice/tone.md"]}
        />
      </State>

      <State
        name="Content loading"
        note="The selected file is still being read. The page keeps its shape."
      >
        <Skill contentState={{ kind: "loading" }} />
      </State>

      <State
        name="Content failed"
        note="Explains what failed and offers a specific retry, inside the section that failed."
      >
        <Skill
          contentState={{
            kind: "error",
            message: "Couldn't read SKILL.md.",
            onRetry: noop,
          }}
        />
      </State>

      <State
        name="Registry skill"
        note="A skills.sh entry the user has not saved. Same page, plus an acquisition control."
      >
        <Skill
          headerControl={{
            kind: "install",
            skillName: "writing-voice",
            installed: false,
            pending: false,
            onInstall: noop,
          }}
        />
      </State>

      <State
        name="Route loading"
        note="Before the skill itself resolves. Shares one treatment with plugins and automations."
      >
        <ResourceListState
          state="loading"
          message="Loading skill"
          layout="detail"
        />
      </State>

      <State name="Route not found" note="The skill does not exist locally.">
        <ResourceListState
          state="empty"
          message="Skill not found."
          layout="detail"
        />
      </State>

      <State
        name="Source unavailable"
        note="Deliberately distinct from not-found: the skill exists, its external source does not."
      >
        <ResourceListState
          state="error"
          message="This registry skill is no longer available from its source."
          layout="detail"
          onRetry={noop}
        />
      </State>
    </Story>
  );
}

// --- Plugins ----------------------------------------------------------------

const PLUGIN: PluginListItem = {
  id: "github",
  source: "npm:@bb-plugins/github",
  rootDir: "/Users/you/.bb/plugins/github",
  version: "1.4.0",
  enabled: true,
  status: "running",
  statusDetail: null,
  description: "Browse GitHub issues and pull requests without leaving bb.",
  name: "GitHub",
  icon: "Github",
  compactIconUrl: null,
  logoUrl: null,
  logoDarkUrl: null,
  hasSettings: false,
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
  capabilities: [],
  app: { hasApp: false, bundle: null },
  provenance: "direct",
  isOrphanedBuiltin: false,
  catalogEntryId: null,
  sourceDisplay: "npm · @bb-plugins/github",
  updateState: EMPTY_PLUGIN_UPDATE_STATE,
};

const NEXT_RUN_AT = new Date(2027, 0, 15, 9).getTime();

const STATIC_CAPABILITIES: PluginListItem["capabilities"] = [
  {
    kind: "skill",
    id: "skills",
    label: "skills",
    detail: "Skills bundled with this plugin",
  },
  {
    kind: "theme",
    id: "github.dark",
    label: "GitHub Dark",
    detail: "A dark palette matching github.com",
  },
];

const FULL_PLUGIN: PluginListItem = {
  ...PLUGIN,
  cliCommand: { name: "gh", summary: "Work with GitHub from the terminal" },
  // One fixture covers every service and schedule state the Activity section
  // can render, so they are reviewed in context instead of as loose icons.
  services: [
    { name: "issue-sync", state: "running" },
    { name: "webhook-listener", state: "backoff" },
    { name: "indexer", state: "stopped" },
  ],
  schedules: [
    {
      name: "daily-digest",
      cron: "0 9 * * *",
      nextRunAt: NEXT_RUN_AT,
      lastRunAt: null,
      lastStatus: "ok",
      lastError: null,
    },
    {
      name: "stale-sweep",
      cron: "0 3 * * 0",
      nextRunAt: NEXT_RUN_AT,
      lastRunAt: null,
      lastStatus: "error",
      lastError: "GitHub API rate limit exceeded",
    },
  ],
  capabilities: [
    ...STATIC_CAPABILITIES,
    {
      kind: "agent-tool",
      id: "gh_search",
      label: "gh_search",
      detail: "Search issues and pull requests",
    },
    {
      kind: "thread-integration",
      id: "mention:pr",
      label: "Pull requests",
      detail: "Mentions with #",
    },
  ],
};

/**
 * The shapes fixtures usually flatter away: an id long enough to have no break
 * opportunity, prose that outgrows one line, and every capability group
 * populated at once.
 */
const AWKWARD_PLUGIN: PluginListItem = {
  ...FULL_PLUGIN,
  id: "enterprise-issue-tracker-synchronization",
  name: "Enterprise Issue Tracker Synchronization",
  rootDir:
    "/Users/you/.bb/plugins/enterprise-issue-tracker-synchronization/packages/runtime",
  description:
    "Keeps issues, pull requests, review comments, and release checklists synchronized between bb threads and your issue tracker, including bidirectional status mapping, attachment mirroring, and per-project field translation.",
  cliCommand: {
    name: "enterprise-issue-tracker-sync",
    summary:
      "Synchronize issues, pull requests, and release checklists in both directions",
  },
  capabilities: [
    ...FULL_PLUGIN.capabilities,
    {
      kind: "agent-tool",
      id: "enterprise_issue_tracker_bulk_transition",
      label: "enterprise_issue_tracker_bulk_transition",
      detail:
        "Transition many issues at once, respecting per-project workflow rules and required fields",
    },
    {
      kind: "thread-integration",
      id: "mention:release-checklist",
      label: "Release checklists",
      detail: "Mentions with @ and #",
    },
  ],
};

function Plugin({ plugin }: { plugin: PluginListItem | null }) {
  return (
    <PluginDetail
      isLoading={false}
      plugin={plugin}
      pending={false}
      openSourceDisabled
      onToggle={noop}
      onEdit={noop}
      onOpenSource={noop}
      onDelete={noop}
    />
  );
}

/**
 * App surfaces reach Includes through the browser slot registry rather than the
 * server payload, because a React component cannot cross that boundary. The
 * story registers them the same way a loaded plugin frontend would.
 */
function PluginWithAppSurfaces() {
  useEffect(() => {
    setPluginSlotRegistrations(PLUGIN.id, {
      homepageSections: [],
      settingsSections: [],
      navPanels: [
        {
          id: "issues",
          title: "Issues",
          icon: "Github",
          path: "issues",
          component: () => null,
        },
      ],
      threadPanelActions: [
        {
          id: "open-pr",
          title: "Open pull request",
          icon: "GitPullRequest",
          component: () => null,
        },
      ],
      sidebarFooterActions: [],
      fileOpeners: [],
      messageDirectives: [],
    });
    return () => removePluginSlotRegistrations(PLUGIN.id);
  }, []);
  return <Plugin plugin={{ ...PLUGIN, app: { hasApp: true, bundle: null } }} />;
}

export function PluginStates() {
  return (
    <Story
      title="Plugin detail states"
      description="A plugin page is About, Includes, then Release, with Settings and Activity in fixed positions between them when they apply. About, Includes, and Release never disappear."
    >
      <State
        name="Full"
        note="Everything declared: a command, skills, themes, agent tools, thread integrations, services, and schedules."
      >
        <Plugin plugin={FULL_PLUGIN} />
      </State>

      <State
        name="Minimal"
        note="Nothing user-facing is declared, so Includes says so rather than vanishing."
      >
        <Plugin plugin={PLUGIN} />
      </State>

      <State
        name="Disabled"
        note="Manifest-declared skills and themes stay accurate; the live capabilities are deferred honestly."
      >
        <Plugin
          plugin={{
            ...PLUGIN,
            enabled: false,
            status: "disabled",
            capabilities: STATIC_CAPABILITIES,
          }}
        />
      </State>

      <State
        name="Unhealthy"
        note="Abnormal runtime health belongs in Activity with a recovery next step, not in a badge on the title."
      >
        <Plugin
          plugin={{
            ...FULL_PLUGIN,
            status: "degraded",
            statusDetail: "Reconnecting to the GitHub API",
            handlerStats: { count: 12, totalMs: 340, maxMs: 90, errorCount: 3 },
          }}
        />
      </State>

      <State
        name="App surfaces"
        note="Surfaces a plugin frontend registers in the browser once it loads. They enrich Includes; the manifest alone cannot name them."
      >
        <PluginWithAppSurfaces />
      </State>

      <State
        name="Awkward content"
        note="Long unbroken names, a wordy description, and every capability group at once. Real plugins are messier than fixtures; this is where wrapping and truncation break."
      >
        <Plugin plugin={AWKWARD_PLUGIN} />
      </State>

      <State name="Route loading" note="Before the plugin list resolves.">
        <Plugin plugin={null} />
      </State>

      <State name="Route not found" note="No plugin with this id is installed.">
        <ResourceListState
          state="empty"
          message="Plugin not found."
          layout="detail"
        />
      </State>

      <State
        name="Route failed"
        note="The list request failed; retry is the only useful action."
      >
        <ResourceListState
          state="error"
          message="Couldn't load plugin."
          layout="detail"
          onRetry={noop}
        />
      </State>
    </Story>
  );
}

// --- Automations ------------------------------------------------------------

const AUTOMATION: AutomationResponse = {
  id: "auto_1",
  projectId: "proj_1",
  name: "Nightly digest",
  enabled: true,
  trigger: { triggerType: "schedule", cron: "0 9 * * 1-5", timezone: "UTC" },
  execution: {
    mode: "agent",
    prompt: "Summarize yesterday's commits and open pull requests.",
    providerId: "claude",
    model: "claude-opus-5",
    permissionMode: "auto",
    environment: { type: "host", workspace: { type: "personal" } },
  },
  origin: "human",
  createdByThreadId: null,
  nextRunAt: NEXT_RUN_AT,
  lastRunAt: null,
  runCount: 0,
  lastRunStatus: null,
  lastRunThreadId: null,
  lastError: null,
  createdAt: new Date(2027, 0, 1).getTime(),
  updatedAt: new Date(2027, 0, 1).getTime(),
};

const SCRIPT_AUTOMATION: AutomationResponse = {
  ...AUTOMATION,
  id: "auto_2",
  name: "Prune caches",
  trigger: { triggerType: "once", runAt: NEXT_RUN_AT },
  execution: {
    mode: "script",
    script: "rm -rf ./node_modules/.cache",
    interpreter: "bash",
    timeoutMs: 60_000,
  },
};

// One fixture per persisted run status, so all four are reviewed together.
const RUNS: AutomationRunResponse[] = (
  [
    ["succeeded", null],
    ["failed", "Exit code 1: provider timed out"],
    ["running", null],
    ["skipped", null],
  ] as const
).map(([status, error], index) => ({
  id: `run_${index}`,
  automationId: AUTOMATION.id,
  runMode: "agent",
  threadId: `thr_${index}`,
  status,
  trigger: index === 0 ? "manual" : "schedule",
  skipReason: status === "skipped" ? "Previous run still in progress" : null,
  error,
  output: null,
  exitCode: null,
  scheduledFor: NEXT_RUN_AT,
  startedAt: NEXT_RUN_AT,
  finishedAt: status === "running" ? null : NEXT_RUN_AT + 42_000,
}));

function Automation({
  automation = AUTOMATION,
  runs = [],
  loading = false,
  error = null,
}: {
  automation?: AutomationResponse;
  runs?: readonly AutomationRunResponse[];
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <AutomationDetailView
      automation={automation}
      projectLabel="Local"
      runsState={{
        runs,
        nextCursor: null,
        loading,
        loadingMore: false,
        error,
        loadMore: noop,
        retry: noop,
      }}
      actionPending={false}
      onToggle={noop}
      onEdit={noop}
      onRunNow={noop}
      onDelete={noop}
      onOpenThread={noop}
    />
  );
}

export function AutomationStates() {
  return (
    <Story
      title="Automation detail states"
      description="An automation page is Definition then Run history. Run history owns its own loading, empty, failed, and populated states without moving."
    >
      <State
        name="Agent automation"
        note="A recurring prompt, with every persisted run status in its history."
      >
        <Automation runs={RUNS} />
      </State>

      <State
        name="Script automation"
        note="A one-time script. Same two sections, different definition content."
      >
        <Automation automation={SCRIPT_AUTOMATION} runs={RUNS.slice(0, 1)} />
      </State>

      <State
        name="No runs yet"
        note="Run history stays in place and explains itself rather than collapsing."
      >
        <Automation />
      </State>

      <State
        name="Run history loading"
        note="The definition is already usable while history is still arriving."
      >
        <Automation loading />
      </State>

      <State
        name="Run history failed"
        note="Only the section that failed shows an error; the definition above it is unaffected."
      >
        <Automation error="Request timed out" />
      </State>

      <State
        name="Paused"
        note="A disabled automation keeps its full definition and history."
      >
        <Automation
          automation={{ ...AUTOMATION, enabled: false }}
          runs={RUNS.slice(0, 2)}
        />
      </State>

      <State name="Route loading" note="Before the automation resolves.">
        <ResourceListState
          state="loading"
          message="Loading automation"
          layout="detail"
        />
      </State>

      <State
        name="Route not found"
        note="The automation was deleted or the id is wrong."
      >
        <ResourceListState
          state="error"
          message="Automation not found."
          layout="detail"
          onRetry={noop}
        />
      </State>
    </Story>
  );
}
