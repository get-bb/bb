import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SkillProvider } from "@bb/server-contract";
import { ResourceListState } from "@bb/shared-ui/resource-list";
import { pluginSourceQueryKey } from "@/hooks/queries/plugin-catalog-queries";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { PluginDetail } from "@/components/tools/PluginDetail";
import { ProviderLogo } from "@/components/tools/SkillsCollection";
import { SkillDetailView } from "@/components/tools/SkillDetailView";

/**
 * Every state each tool type's detail page can be in, rendered as the real
 * page. One story per tool type: scroll it and you have reviewed that type.
 *
 * These are the whole Extensions detail story surface, deliberately. Anything a running
 * server would show you is better seen in the running app, and anything that
 * must not regress belongs in a test — `detail-page-recipes.test.tsx` pins
 * section order and labels, `SkillsView.test.tsx` and `ToolsSidebar.test.tsx`
 * pin routing. What is left, and what these cover, is the states a healthy
 * local server will not produce on demand: loading, missing, failed, empty,
 * and disabled — plus content ugly enough to break a layout.
 */
export default {
  title: "Extensions",
};

const noop = () => {};

function PluginStoryQueryBoundary({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          refetchOnMount: false,
          refetchOnReconnect: false,
          refetchOnWindowFocus: false,
        },
      },
    });
    for (const pluginId of [
      "github",
      "github-app-surfaces",
      "github-update-available",
      "github-update-failed",
      "github-compatibility-blocked",
      "enterprise-issue-tracker-synchronization",
    ]) {
      client.setQueryData(pluginSourceQueryKey(pluginId), {
        requested: `npm:@bb-plugins/${pluginId}`,
        resolved: "1.4.0",
        integrity: null,
        registry: "npm",
        engines: { bb: null, bbPluginSdk: null },
        installedAt: new Date(2026, 6, 8).getTime(),
        history: [],
      });
    }
    return client;
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

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

/**
 * The leading slot carries the skill's provider, exactly as the real library
 * rows and detail route do — a provider logo when the skill is discovered
 * under one, the bb mark when it is not. Omitting it here would make every
 * state below misrepresent the page.
 */
function SkillLeading({ provider }: { provider: SkillProvider | null }) {
  if (provider === null) {
    return (
      <img
        src="/bb-mark.svg"
        alt=""
        aria-hidden
        className="size-4 object-contain dark:invert"
      />
    );
  }
  return <ProviderLogo providerId={provider} className="size-4" />;
}

function Skill({
  files = [SKILL_PATH],
  contentState = {
    kind: "ready" as const,
    content:
      "# writing-voice\n\nLead with the answer. Cut hedging. Prefer short sentences.",
  },
  headerControl,
  provider = null,
}: {
  files?: readonly string[];
  contentState?: Parameters<typeof SkillDetailView>[0]["contentState"];
  headerControl?: Parameters<typeof SkillDetailView>[0]["headerControl"];
  provider?: SkillProvider | null;
}) {
  return (
    <SkillDetailView
      leading={<SkillLeading provider={provider} />}
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

export function SkillDetailStates() {
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
        name="Provider-owned"
        note="A skill discovered under Claude Code or Codex carries that provider's logo where a bb-owned skill carries the bb mark."
      >
        <Skill provider="claude-code" />
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
        name="Provider-owned, read-only"
        note="Ownership is passive: a skill bb cannot write shows its origin as a status, with no edit or acquisition control."
      >
        <Skill
          provider="claude-code"
          headerControl={{
            kind: "status",
            label: "Imported",
            tooltip: "Discovered in Claude Code",
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

const APP_SURFACE_PLUGIN = {
  ...PLUGIN,
  id: "github-app-surfaces",
  app: { hasApp: true, bundle: null },
} satisfies PluginListItem;

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

/**
 * Release is not always two quiet facts. An offered update, a rolled-back
 * update, and an update held back by compatibility each add a surface around
 * those facts. They are built on the minimal plugin so the state under review
 * is Release itself, and each carries its own id so the seeded source query
 * covers it without a backend request.
 */
const UPDATE_AVAILABLE_PLUGIN: PluginListItem = {
  ...PLUGIN,
  id: "github-update-available",
  updateState: {
    ...EMPTY_PLUGIN_UPDATE_STATE,
    availableVersion: "1.5.0",
    lastCheckAt: new Date(2026, 6, 20).getTime(),
  },
};

const UPDATE_FAILED_PLUGIN: PluginListItem = {
  ...PLUGIN,
  id: "github-update-failed",
  updateState: {
    ...EMPTY_PLUGIN_UPDATE_STATE,
    lastFailure: {
      version: "1.5.0",
      at: new Date(2026, 6, 22).getTime(),
      detail: "The plugin failed to load after the update.",
    },
  },
};

/**
 * A bundled plugin has no update channel of its own, so Release states the
 * policy instead of an install date. That is the longest release value the
 * section carries, and it needs no source request at all.
 */
const BUNDLED_PLUGIN: PluginListItem = {
  ...PLUGIN,
  id: "github-bundled",
  source: "builtin:github",
  rootDir: "/managed/plugins/github",
  provenance: "builtin",
  sourceDisplay: "Ships with bb",
  capabilities: STATIC_CAPABILITIES,
};

const COMPATIBILITY_BLOCKED_PLUGIN: PluginListItem = {
  ...PLUGIN,
  id: "github-compatibility-blocked",
  updateState: {
    ...EMPTY_PLUGIN_UPDATE_STATE,
    blockedVersion: "2.0.0",
    blockedReasons: ["Requires bb 0.20 or newer, and this bb is 0.18."],
  },
};

function Plugin({
  plugin,
  isLoading = false,
}: {
  plugin: PluginListItem | null;
  isLoading?: boolean;
}) {
  return (
    <PluginDetail
      isLoading={isLoading}
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
    setPluginSlotRegistrations(APP_SURFACE_PLUGIN.id, {
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
    return () => removePluginSlotRegistrations(APP_SURFACE_PLUGIN.id);
  }, []);
  return <Plugin plugin={APP_SURFACE_PLUGIN} />;
}

export function PluginDetailStates() {
  return (
    <PluginStoryQueryBoundary>
      <Story
        title="Plugin detail states"
        description="A plugin page opens with one receded About block — the description beside the release facts — and then Capabilities, which is what the page is for. Settings and the two health tables follow only when they apply. About and Capabilities never disappear."
      >
        <State
          name="Full"
          note="Capabilities names what the plugin adds. Background services and scheduled jobs are separate tables because they are separate objects with separate status vocabularies."
        >
          <Plugin plugin={FULL_PLUGIN} />
        </State>

        <State
          name="Minimal"
          note="Nothing user-facing is declared, so Capabilities says so rather than vanishing, and neither health table renders."
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
          note="Runtime health and failed handler calls are problems to act on, so they join the banner stack under the header rather than sitting below the content they explain."
        >
          <Plugin
            plugin={{
              ...FULL_PLUGIN,
              status: "degraded",
              statusDetail: "Reconnecting to the GitHub API",
              handlerStats: {
                count: 12,
                totalMs: 340,
                maxMs: 90,
                errorCount: 3,
              },
            }}
          />
        </State>

        <State
          name="App surfaces"
          note="Surfaces a plugin frontend registers in the browser once it loads. They enrich Capabilities; the manifest alone cannot name them."
        >
          <PluginWithAppSurfaces />
        </State>

        <State
          name="Awkward content"
          note="Long unbroken names, a wordy description, and every capability group at once. Real plugins are messier than fixtures; this is where wrapping and truncation break."
        >
          <Plugin plugin={AWKWARD_PLUGIN} />
        </State>

        <State
          name="Bundled"
          note="Ships with bb, so About names the update policy instead of an install date and the header shows passive provenance rather than an uninstall control."
        >
          <Plugin plugin={BUNDLED_PLUGIN} />
        </State>

        <State
          name="Update available"
          note="An offered update is a banner under the header, so the action is visible without the quiet common case growing a surface."
        >
          <Plugin plugin={UPDATE_AVAILABLE_PLUGIN} />
        </State>

        <State
          name="Update failed"
          note="A rolled-back update explains what happened and what version is running now."
        >
          <Plugin plugin={UPDATE_FAILED_PLUGIN} />
        </State>

        <State
          name="Compatibility blocked"
          note="A newer release exists but cannot be installed. This is an exception, so it keeps a tone, an icon, and its own details action instead of reading as another fact."
        >
          <Plugin plugin={COMPATIBILITY_BLOCKED_PLUGIN} />
        </State>

        <State name="Route loading" note="Before the plugin list resolves.">
          <Plugin plugin={null} isLoading />
        </State>

        <State
          name="Route not found"
          note="No plugin with this id is installed."
        >
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
    </PluginStoryQueryBoundary>
  );
}
