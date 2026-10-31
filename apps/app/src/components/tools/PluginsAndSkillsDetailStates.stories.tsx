import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  InstalledPlugin,
  PluginInstallJob,
  SkillProvider,
} from "@bb/server-contract";
import {
  ResourceInstallControl,
  ResourceListState,
  ResourceOverflowMenu,
} from "@bb/shared-ui/resource-list";
import { Switch } from "@bb/shared-ui/switch";
import { AddPluginDialog } from "@/components/plugin/management/AddPluginDialog";
import { PluginCardGrid } from "@/components/plugin/management/PluginCard";
import { PluginCatalogCard } from "@/components/plugin/management/PluginCatalogCard";
import { PluginDetailReleaseControl } from "@/components/plugin/management/PluginUpdatesCard";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import {
  pluginInstallJobsQueryKey,
  pluginListQueryKey,
  pluginSourceQueryKey,
} from "@/hooks/queries/query-keys";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  CatalogPluginDetail,
  CatalogPluginDetailBanner,
  PluginDetail,
  PluginDetailBanners,
} from "@/components/tools/PluginDetail";
import {
  ProviderLogo,
  SkillProvenanceTooltip,
} from "@/components/tools/SkillsCollection";
import { BbLogo } from "@/components/ui/bb-logo";
import { ProvenancePill } from "@/components/tools/ProvenancePill";
import { SkillDetailView } from "@/components/tools/SkillDetailView";
import {
  makeInstalledPlugin,
  makePluginListItem,
  makePluginRegistrationSet,
} from "@/test/fixtures/plugins";

export default {
  title: "Plugins and Skills/Detail states",
};

const noop = () => {};

function pageLink(entryId: string): string {
  return `https://getbb.app/marketplace/${entryId}?utm_source=bb&utm_medium=share`;
}

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
      "github-official",
      "github-app-surfaces",
      "github-update-available",
      "github-update-failed",
      "github-compatibility-blocked",
      "enterprise-issue-tracker-synchronization",
      ...COPY_LINK_STORY_SOURCE_PLUGIN_IDS,
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
    client.setQueryData(pluginInstallJobsQueryKey(), [
      COPY_LINK_STORY_INSTALL_JOB,
    ]);
    return client;
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function Story({
  title,
  description,
  renderedLabel = "Rendered page",
  renderedNote = "The real component",
  children,
}: {
  title: string;
  description: string;
  renderedLabel?: string;
  renderedNote?: string;
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
              {renderedLabel}
            </span>
            <span className="text-2xs text-subtle-foreground">
              {renderedNote}
            </span>
          </span>
        </div>
        {children}
      </div>
    </main>
  );
}

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

const SKILL_PATH = "/Users/you/.bb/skills/writing-voice/SKILL.md";

function SkillLeading({ provider }: { provider: SkillProvider | null }) {
  if (provider === null) {
    return <BbLogo />;
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
  titleBadge,
  headerActions,
  provider = null,
}: {
  files?: readonly string[];
  contentState?: Parameters<typeof SkillDetailView>[0]["contentState"];
  titleBadge?: Parameters<typeof SkillDetailView>[0]["titleBadge"];
  headerActions?: Parameters<typeof SkillDetailView>[0]["headerActions"];
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
      titleBadge={titleBadge}
      headerActions={headerActions}
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
        note="Explains what failed and offers a specific retry inside the affected section. The copy stays neutral; the red icon carries failure severity."
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
        name="BB Official"
        note="A skill that ships with bb uses the same publisher badge as a BB Official plugin. Its read-only behavior remains a separate permission fact."
      >
        <Skill
          titleBadge={{
            label: "BB Official",
            tooltip: "Ships with bb",
          }}
        />
      </State>

      <State
        name="Included"
        note="A skill supplied by another plugin names that dependency without implying that the skill was acquired separately."
      >
        <Skill
          titleBadge={{
            label: "Included",
            tooltip: (
              <SkillProvenanceTooltip
                prefix="Included with"
                providerId={null}
                name="GitHub plugin"
              />
            ),
          }}
        />
      </State>

      <State
        name="Imported"
        note="Ownership is passive: a skill bb cannot write shows its origin as a status, with no edit or acquisition control."
      >
        <Skill
          provider="claude-code"
          titleBadge={{
            label: "Imported",
            tooltip: (
              <SkillProvenanceTooltip
                prefix="Discovered from"
                providerId="claude-code"
                name="Claude Code"
              />
            ),
          }}
        />
      </State>

      <State
        name="Before ownership"
        note="A registry skill has no ownership badge. Fork is the acquisition action at the trailing edge of the detail header."
      >
        <Skill
          headerActions={
            <ResourceInstallControl
              accessibleLabel="Fork writing-voice into a new bb skill"
              label="Fork"
              icon="Fork"
              onAction={noop}
            />
          }
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

const PLUGIN: PluginListItem = makePluginListItem({
  id: "github",
  source: "npm:@bb-plugins/github",
  rootDir: "/Users/you/.bb/plugins/github",
  version: "1.4.0",
  description: "Browse GitHub issues and pull requests without leaving bb.",
  name: "GitHub",
  icon: "Github",
  sourceDisplay: "npm · @bb-plugins/github",
});

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

const UPDATE_AVAILABLE_PLUGIN: PluginListItem = {
  ...PLUGIN,
  id: "github-update-available",
  updateState: {
    ...EMPTY_PLUGIN_UPDATE_STATE,
    availableVersion: "1.5.0",
    availableLabel: "1.5.0",
    lastCheckAt: new Date(2026, 6, 20).getTime(),
  },
};

const UPDATE_FAILED_PLUGIN: PluginListItem = {
  ...PLUGIN,
  id: "github-update-failed",
  updateState: {
    ...EMPTY_PLUGIN_UPDATE_STATE,
    availableVersion: "1.5.0",
    availableLabel: "1.5.0",
    lastFailure: {
      version: "1.5.0",
      label: "1.5.0",
      at: new Date(2026, 6, 22).getTime(),
      detail: "The plugin failed to load after the update.",
    },
  },
};

const BUNDLED_PLUGIN: PluginListItem = {
  ...PLUGIN,
  id: "github-bundled",
  source: "builtin:github",
  rootDir: "/managed/plugins/github",
  provenance: "builtin",
  sourceDisplay: "Ships with bb",
  capabilities: STATIC_CAPABILITIES,
};

const UNINSTALLED_CATALOG_PLUGIN = {
  entryId: "github",
  marketplace: "bb-official",
  pluginId: "github",
  displayName: "GitHub",
  description: "Browse GitHub issues and pull requests without leaving bb.",
  icon: "Github",
  iconUrl: null,
  iconTinted: false,
  categoryId: "code-and-reviews",
  category: "Code & Reviews",
  overview: `Review pull requests and triage issues from the thread you are working in.

## What you get

- A pull request panel with checks, reviews, and the diff for the current branch.
- Issue search that attaches an issue to the thread as context.
- A \`bb github\` command for agents to open, update, and comment on pull requests.

## How it works

Sign in once with \`gh auth login\`. The plugin reuses your GitHub CLI session and never stores a token of its own.`,
  screenshots: [],
  collections: [],
  source: "builtin:github",
  repositoryUrl: null,
  marketplaceDisplayName: "BB Official",
  publisherKey: "bb-official",
  publisherLabel: "BB Official",
  official: true,
  author: null,
  installed: false,
  conflictingInstallSource: null,
  installedByDefault: false,
  installs: null,
  compatible: true,
  incompatibleReason: null,
  marketplacePageUrl: pageLink("github"),
} satisfies PluginCatalogSearchEntry;

const COMPATIBILITY_BLOCKED_PLUGIN: PluginListItem = {
  ...PLUGIN,
  id: "github-compatibility-blocked",
  updateState: {
    ...EMPTY_PLUGIN_UPDATE_STATE,
    blockedVersion: "2.0.0",
    blockedLabel: "2.0.0",
    blockedReasons: ["Requires bb 0.20 or newer, and this bb is 0.18."],
  },
};

function FailedReleaseLifecycle() {
  const [plugin, setPlugin] = useState(UPDATE_FAILED_PLUGIN);

  useEffect(() => {
    const originalFetch = globalThis.fetch;
    let cancelled = false;
    globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (!url.endsWith(`/plugins/${UPDATE_FAILED_PLUGIN.id}/update`)) {
        return originalFetch.call(globalThis, input, init);
      }

      await new Promise((resolve) => window.setTimeout(resolve, 8_000));
      if (!cancelled) {
        setPlugin((current) => ({
          ...current,
          version: "1.5.0",
          updateState: {
            ...EMPTY_PLUGIN_UPDATE_STATE,
            outcome: "current",
            lastCheckAt: Date.now(),
          },
        }));
      }
      return new Response(
        JSON.stringify({
          applied: true,
          from: { version: "1.4.0", display: "1.4.0" },
          to: { version: "1.5.0", display: "1.5.0" },
          outcome: "updated",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    return () => {
      cancelled = true;
      globalThis.fetch = originalFetch;
    };
  }, []);

  return <Plugin plugin={plugin} />;
}

function Plugin({
  plugin,
  isLoading = false,
}: {
  plugin: PluginListItem | null;
  isLoading?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      {plugin === null ? null : (
        <div className="-mx-4 md:-mx-5">
          <PluginDetailBanners
            plugin={plugin}
            catalogEntries={[]}
            onOpenPlugin={noop}
          />
        </div>
      )}
      <div className="pt-3 md:pt-4">
        <PluginDetail
          isLoading={isLoading}
          plugin={plugin}
          pending={false}
          openSourceDisabled
          onToggle={noop}
          onEdit={noop}
          onOpenSource={noop}
          onDelete={noop}
          catalogEntries={[]}
          onOpenPlugin={noop}
        />
      </div>
    </div>
  );
}

function CatalogPlugin({
  entry = UNINSTALLED_CATALOG_PLUGIN,
}: {
  entry?: PluginCatalogSearchEntry;
}) {
  const [installOpen, setInstallOpen] = useState(false);
  return (
    <>
      <div className="-mx-4 md:-mx-5">
        <CatalogPluginDetailBanner entry={entry} onOpenPlugin={noop} />
      </div>
      <div className="pt-3 md:pt-4">
        <CatalogPluginDetail
          entry={entry}
          onInstall={() => setInstallOpen(true)}
          catalogEntries={[entry]}
          onOpenPlugin={noop}
        />
      </div>
      <AddPluginDialog
        open={installOpen}
        initial={{
          entryId: entry.entryId,
          pluginId: entry.pluginId,
          marketplace: "bb-official",
          publisherLabel: "BB Official",
          displayName: entry.displayName,
          icon: entry.icon,
          iconUrl: entry.iconUrl,
          iconTinted: entry.iconTinted,
          source: entry.source,
        }}
        onOpenChange={setInstallOpen}
      />
    </>
  );
}

function PluginWithAppSurfaces() {
  useEffect(() => {
    setPluginSlotRegistrations(
      APP_SURFACE_PLUGIN.id,
      makePluginRegistrationSet({
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
      }),
    );
    return () => removePluginSlotRegistrations(APP_SURFACE_PLUGIN.id);
  }, []);
  return <Plugin plugin={APP_SURFACE_PLUGIN} />;
}

export function PluginDetailStates() {
  return (
    <PluginStoryQueryBoundary>
      <Story
        title="Plugin detail states"
        description="An uninstalled BB Official plugin shows the catalog facts bb can verify and offers Install. Once installed, the page adds runtime capabilities, settings, services, and schedules when they apply."
      >
        <State
          name="Before ownership"
          note="An uninstalled BB Official plugin opens as a real detail page. Install is the primary header action; the full-trust confirmation is the commit step."
        >
          <CatalogPlugin />
        </State>

        <State
          name="Before ownership · incompatible"
          note="The same page keeps Install visible but disabled. Its acquisition blocker uses the same full-width notice alignment as installed-plugin conditions, while the copy keeps the taxonomy clear."
        >
          <CatalogPlugin
            entry={{
              ...UNINSTALLED_CATALOG_PLUGIN,
              compatible: false,
              incompatibleReason: "Requires bb 0.20 or newer.",
            }}
          />
        </State>

        <State
          name="Full"
          note="Capabilities names what the plugin adds. Background services use a conventional Status/Service table; scheduled jobs use a separate table for next-run and failure detail."
        >
          <Plugin plugin={FULL_PLUGIN} />
        </State>

        <State
          name="Minimal"
          note="Nothing user-facing is declared, so Capabilities says so rather than vanishing, and neither activity section renders."
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
          note="Runtime health is the primary banner. It explains the user-facing condition and recovery without exposing the service identifier or unrelated cumulative handler failures."
        >
          <Plugin
            plugin={{
              ...FULL_PLUGIN,
              status: "degraded",
              statusDetail: "service issue-sync did not stop",
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
          name="BB Official · catalog"
          note="Installed from bb's catalog. It shares the BB Official badge with built-in plugins, while its install date and ownership menu preserve the lifecycle difference."
        >
          <Plugin plugin={CATALOG_PLUGIN} />
        </State>

        <State
          name="BB Official · built-in"
          note="Ships with bb. The badge matches catalog-installed official plugins; the missing install date and ownership menu show that it cannot be uninstalled separately."
        >
          <Plugin plugin={BUNDLED_PLUGIN} />
        </State>

        <State
          name="Update available"
          note="Identity and path use the standard detail header. Installed date and current version remain passive table facts; the compact Update action sits in the Release section header, separate from activation and ownership."
        >
          <Plugin plugin={UPDATE_AVAILABLE_PLUGIN} />
        </State>

        <State
          name="Update failed"
          note="The current version is still running after rollback. A dedicated Update row explains what was restored; Retry remains the primary Release action above the table."
        >
          <Plugin plugin={UPDATE_FAILED_PLUGIN} />
        </State>

        <State
          name="Compatibility blocked"
          note="A newer release requires a newer bb. A dedicated Update row explains the requirement and preserved version; there is no unavailable action or modal."
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

export function PluginBannerStates() {
  return (
    <PluginStoryQueryBoundary>
      <Story
        title="Plugin health banners"
        description="Each present-tense runtime condition appears in its production position on the real plugin detail page: a full-width banner above the plugin identity and content it affects."
        renderedLabel="Rendered detail page"
        renderedNote="The real health banner above the plugin page"
      >
        <State
          name="Health · Failed"
          note="The plugin runtime or browser interface could not start. The banner gives Reload recovery without exposing the underlying process error."
        >
          <Plugin
            plugin={{
              ...PLUGIN,
              status: "error",
              statusDetail: "worker process exited unexpectedly",
            }}
          />
        </State>

        <State
          name="Health · Degraded"
          note="The plugin still runs while a background service finishes stopping. The banner gives the supported wait-and-reload recovery; service identifiers and cumulative handler failures remain diagnostic data."
        >
          <Plugin
            plugin={{
              ...FULL_PLUGIN,
              status: "degraded",
              statusDetail: "service issue-sync did not stop",
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
          name="Health · Incompatible"
          note="The installed plugin cannot run with this version of bb. The banner directs the user to install a compatible version without repeating the server's raw compatibility string."
        >
          <Plugin
            plugin={{
              ...PLUGIN,
              status: "incompatible",
              statusDetail: "requires bb 0.20 or newer",
            }}
          />
        </State>

        <State
          name="Health · Missing"
          note="The installed entry remains, but its plugin files are missing. The banner gives the source-appropriate remove-and-reinstall resolution."
        >
          <Plugin
            plugin={{
              ...PLUGIN,
              status: "missing",
              statusDetail: "plugin directory was not found",
            }}
          />
        </State>

        <State
          name="Health · Needs configuration"
          note="Required settings are incomplete. Saving Settings reloads the plugin, so the banner adds no duplicate action."
        >
          <Plugin
            plugin={{
              ...PLUGIN,
              status: "needs-configuration",
              statusDetail: "an API token is required",
              hasSettings: true,
            }}
          />
        </State>

        <State
          name="Health · Needs configuration · external"
          note="The required value lives outside the Settings section. The plugin-authored message names it, and Reload becomes the supported action after the user adds it."
        >
          <Plugin
            plugin={{
              ...PLUGIN,
              status: "needs-configuration",
              statusDetail: "Set GITHUB_TOKEN in the server environment.",
              hasSettings: false,
            }}
          />
        </State>
      </Story>
    </PluginStoryQueryBoundary>
  );
}

export function PluginReleaseStates() {
  return (
    <PluginStoryQueryBoundary>
      <Story
        title="Plugin release states"
        description="Release actions stay beside the section label. A dedicated Update row appears only when a release is available, failed, or blocked; successful updates return to the normal release state after a transient confirmation."
        renderedLabel="Rendered detail page"
        renderedNote="The real Release section below plugin identity"
      >
        <State
          name="Release · normal"
          note="No update action or outcome is present. Release contains only the installed date and current version."
        >
          <Plugin plugin={PLUGIN} />
        </State>

        <State
          name="Release · update available"
          note="The Update row names the available version while the optional action stays in the Release section header and opens confirmation before changing anything."
        >
          <Plugin plugin={UPDATE_AVAILABLE_PLUGIN} />
        </State>

        <State
          name="Release · failed / retry / updating / completed"
          note="The Update row explains the rollback while Retry stays beside Release. Click Retry to inspect the real pending action for 8 seconds; success advances Version to 1.5.0, removes the stale Update row, and shows the production completion toast."
        >
          <FailedReleaseLifecycle />
        </State>

        <State
          name="Release · update blocked"
          note="Not a banner and not a failed attempt. The Update row names the bb-version requirement and preserved installed version; there is no unavailable action or dialog to dismiss."
        >
          <Plugin plugin={COMPATIBILITY_BLOCKED_PLUGIN} />
        </State>
      </Story>
    </PluginStoryQueryBoundary>
  );
}

function NoControl({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs italic text-subtle-foreground">{children}</span>
  );
}

function ControlTable({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="max-w-full overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
          <thead className="bg-surface-recessed/55 text-xs text-muted-foreground">
            <tr>
              <th className="w-48 px-3 py-2 text-left font-medium">State</th>
              <th className="w-64 px-3 py-2 text-left font-medium">
                Rendered control
              </th>
              <th className="px-3 py-2 text-left font-medium">Meaning</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">{children}</tbody>
        </table>
      </div>
    </section>
  );
}

function ControlRow({
  state,
  control,
  meaning,
}: {
  state: string;
  control: ReactNode;
  meaning: ReactNode;
}) {
  return (
    <tr>
      <th className="px-3 py-2.5 text-left align-top text-xs font-medium text-foreground">
        {state}
      </th>
      <td className="px-3 py-2.5 text-left align-top">
        <div className="flex min-h-7 items-start justify-start">{control}</div>
      </td>
      <td className="px-3 py-2.5 text-left align-top text-xs leading-relaxed text-muted-foreground">
        {meaning}
      </td>
    </tr>
  );
}

const CATALOG_PLUGIN = {
  ...PLUGIN,
  id: "github-official",
  provenance: "catalog",
  catalogEntryId: "github",
  catalogMarketplaceName: "bb-community",
  publisherLabel: "BB Community",
  marketplacePageUrl: pageLink("github"),
} satisfies PluginListItem;

const pluginUninstallItems = [
  {
    label: "Uninstall",
    icon: "Trash2" as const,
    tone: "destructive" as const,
    onSelect: noop,
  },
];

const pluginCatalogItems = [
  {
    label: "Uninstall",
    icon: "Trash2" as const,
    tone: "destructive" as const,
    onSelect: noop,
  },
];

const pluginLocalItems = [
  { label: "Edit", icon: "Edit" as const, onSelect: noop },
  { label: "Open source", icon: "ExternalLink" as const, onSelect: noop },
  {
    label: "Remove from bb",
    icon: "Trash2" as const,
    tone: "destructive" as const,
    onSelect: noop,
  },
];

const skillLocalItems = [
  { label: "Edit", icon: "Edit" as const, onSelect: noop },
  { label: "Open source", icon: "ExternalLink" as const, onSelect: noop },
  { kind: "separator" as const },
  {
    label: "Delete",
    icon: "Trash2" as const,
    tone: "destructive" as const,
    onSelect: noop,
  },
];

export function ResourceControlStates() {
  return (
    <PluginStoryQueryBoundary>
      <main className="mx-auto w-full max-w-[72rem] space-y-8 px-5 py-6">
        <header>
          <h1 className="text-lg font-semibold text-foreground">
            Resource badge and button states
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            The real controls used by Plugins and Skills, grouped by the meaning
            they carry. Cells are deliberately left-aligned so shape, weight,
            and vocabulary can be compared directly.
          </p>
        </header>

        <ControlTable
          title="Before ownership"
          description="Install and Fork are sibling acquisition actions. They share one control shape; their verbs describe what ownership means for each resource."
        >
          <ControlRow
            state="Plugin · Install"
            control={
              <ResourceInstallControl
                accessibleLabel="Install example plugin"
                onAction={noop}
              />
            }
            meaning="Canonical BB Official plugin acquisition action on both Browse and the pre-ownership detail page."
          />
          <ControlRow
            state="Plugin · installing"
            control={
              <ResourceInstallControl
                accessibleLabel="Install example plugin"
                pending
                onAction={noop}
              />
            }
            meaning="The same acquisition action while installation is in flight."
          />
          <ControlRow
            state="Skill · Fork"
            control={
              <ResourceInstallControl
                accessibleLabel="Fork example skill into a new bb skill"
                label="Fork"
                icon="Fork"
                onAction={noop}
              />
            }
            meaning="Creates a new bb-owned skill from a registry source on the skill detail page."
          />
          <ControlRow
            state="Skill · forking"
            control={
              <ResourceInstallControl
                accessibleLabel="Fork example skill into a new bb skill"
                label="Fork"
                icon="Fork"
                pending
                pendingLabel="Forking"
                onAction={noop}
              />
            }
            meaning="The sibling skill acquisition action while the fork is in flight."
          />
        </ControlTable>

        <ControlTable
          title="Owned detail-page badges"
          description="Badges appear only when provenance changes how the resource should be understood. Ordinary owned resources stay unlabelled in their detail-page stories."
        >
          <ControlRow
            state="Skill · BB Official"
            control={
              <ProvenancePill label="BB Official" tooltip="Ships with bb" />
            }
            meaning="A skill that ships with bb."
          />
          <ControlRow
            state="Skill · Included"
            control={
              <ProvenancePill
                label="Included"
                tooltip={
                  <SkillProvenanceTooltip
                    prefix="Included with"
                    providerId="claude-code"
                    name="GitHub plugin"
                  />
                }
              />
            }
            meaning="A skill bundled inside another plugin."
          />
          <ControlRow
            state="Skill · Imported"
            control={
              <ProvenancePill
                label="Imported"
                tooltip={
                  <SkillProvenanceTooltip
                    prefix="Discovered from"
                    providerId="claude-code"
                    name="Claude Code"
                  />
                }
              />
            }
            meaning="A skill discovered from another provider."
          />
        </ControlTable>

        <ControlTable
          title="Plugin lifecycle and ownership actions"
          description="The provenance badge never doubles as a control. Runtime lifecycle and destructive ownership actions remain separate."
        >
          <ControlRow
            state="Enabled"
            control={
              <Switch
                checked
                aria-label="Disable example plugin"
                onCheckedChange={noop}
              />
            }
            meaning="The plugin runtime is enabled."
          />
          <ControlRow
            state="Disabled"
            control={
              <Switch
                checked={false}
                aria-label="Enable example plugin"
                onCheckedChange={noop}
              />
            }
            meaning="The plugin remains installed but its runtime is disabled."
          />
          <ControlRow
            state="Lifecycle pending"
            control={
              <Switch
                checked
                disabled
                aria-label="Plugin update pending"
                onCheckedChange={noop}
              />
            }
            meaning="A plugin mutation is in flight, so the lifecycle switch cannot race it."
          />
          <ControlRow
            state="Direct installed actions"
            control={
              <ResourceOverflowMenu
                label="Direct plugin actions"
                items={pluginUninstallItems}
              />
            }
            meaning="Direct installs can be submitted to the marketplace or uninstalled."
          />
          <ControlRow
            state="Catalog installed actions"
            control={
              <ResourceOverflowMenu
                label="Catalog plugin actions"
                items={pluginCatalogItems}
              />
            }
            meaning="Official catalog installs are already published, so their ownership menu only offers uninstall."
          />
          <ControlRow
            state="Local actions"
            control={
              <ResourceOverflowMenu
                label="Local plugin actions"
                items={pluginLocalItems}
              />
            }
            meaning="Local sources can be edited, opened, submitted to the marketplace, or removed from bb without deleting the source directory."
          />
          <ControlRow
            state="BB Official built-in actions"
            control={<NoControl>No ownership menu</NoControl>}
            meaning="Built-in plugins cannot be uninstalled or source-edited here."
          />
        </ControlTable>

        <ControlTable
          title="Plugin release actions"
          description="Update and Retry are primary Release actions. Their context stays with Version; a blocked update has no unavailable action. The complete flow is demonstrated in Plugin release states."
        >
          <ControlRow
            state="Update available"
            control={
              <PluginDetailReleaseControl plugin={UPDATE_AVAILABLE_PLUGIN} />
            }
            meaning="A compatible release is available; no warning or failure has occurred."
          />
          <ControlRow
            state="Retry update"
            control={
              <PluginDetailReleaseControl plugin={UPDATE_FAILED_PLUGIN} />
            }
            meaning="The last attempt rolled back; the compatible update remains available to retry."
          />
        </ControlTable>

        <ControlTable
          title="Skill ownership actions"
          description="Only mutable local skills expose ownership actions; provenance badges remain passive."
        >
          <ControlRow
            state="Fork · browse card"
            control={
              <ResourceInstallControl
                accessibleLabel="Fork example skill into a new bb skill"
                label="Fork"
                icon="Fork"
                presentation="icon"
                tooltip="Fork example skill"
                onAction={noop}
              />
            }
            meaning="The same action in the compact card-header presentation."
          />
          <ControlRow
            state="Local actions"
            control={
              <ResourceOverflowMenu
                label="Local skill actions"
                items={skillLocalItems}
              />
            }
            meaning="A bb-owned skill can be edited, opened, or deleted."
          />
          <ControlRow
            state="Read-only actions"
            control={<NoControl>No ownership menu</NoControl>}
            meaning="BB Official, Included, and Imported skills expose provenance without pretending they are mutable."
          />
        </ControlTable>
      </main>
    </PluginStoryQueryBoundary>
  );
}

const COPY_LINK_STORY_SOURCE_PLUGIN_IDS = [
  "agent-annotations",
  "github-community-link",
];

const COPY_LINK_STORY_INSTALL_JOB = {
  id: "job-copy-link-story",
  target: {
    kind: "catalog",
    entryId: "bb--git",
    marketplace: "bb-official",
  },
  displayName: "Git",
  state: "running",
} as const;

const LINK_CATALOG_ENTRY = {
  ...UNINSTALLED_CATALOG_PLUGIN,
  entryId: "agent-annotations",
  pluginId: "agent-annotations",
  displayName: "Agent Annotations",
  description: "Comment on any agent output and send the notes back as a turn.",
  overview:
    "Select any part of an agent's reply, leave a note, and send every note back as one turn.",
  icon: "Edit",
  categoryId: "tasks-and-workflows",
  category: "Tasks & Workflows",
  source: "builtin:agent-annotations",
  marketplacePageUrl: pageLink("agent-annotations"),
} satisfies PluginCatalogSearchEntry;

const LINK_INSTALLING_ENTRY = {
  ...LINK_CATALOG_ENTRY,
  entryId: "bb--git",
  pluginId: "git",
  displayName: "Git",
  description: "Stage, commit, and review changes from the thread you are in.",
  overview: "Stage, commit, and review changes without leaving the thread.",
  icon: "GitBranch",
  source: "builtin:git",
  marketplacePageUrl: pageLink("bb--git"),
} satisfies PluginCatalogSearchEntry;

const LINK_COMMUNITY_ENTRY = {
  ...LINK_CATALOG_ENTRY,
  entryId: "linear-sync",
  pluginId: "linear-sync",
  displayName: "Linear Sync",
  description: "Attach Linear issues to threads and update them as work lands.",
  overview: "Attach Linear issues to threads and update them as work lands.",
  icon: "Link",
  source: "npm:linear-sync-bb",
  marketplace: "bb-community",
  marketplaceDisplayName: "BB Community",
  publisherKey: "github:mira-dev",
  publisherLabel: "mira-dev",
  official: false,
  author: {
    name: "Mira",
    github: "mira-dev",
    url: "https://github.com/mira-dev",
  },
  installs: 1240,
  marketplacePageUrl: pageLink("linear-sync"),
} satisfies PluginCatalogSearchEntry;

const LINK_UNLISTED_ENTRY = {
  ...LINK_CATALOG_ENTRY,
  entryId: "provider-codex",
  pluginId: "provider-codex",
  displayName: "Codex",
  description: "Run threads with OpenAI Codex.",
  overview: "Run threads with OpenAI Codex.",
  icon: "Bot",
  source: "builtin:provider-codex",
  marketplacePageUrl: null,
} satisfies PluginCatalogSearchEntry;

const LINK_OFFICIAL_INSTALLED: PluginListItem = {
  ...PLUGIN,
  id: "agent-annotations",
  name: "Agent Annotations",
  description: LINK_CATALOG_ENTRY.description,
  icon: "Edit",
  source: "catalog:bb-official/agent-annotations",
  provenance: "catalog",
  catalogEntryId: "agent-annotations",
  catalogMarketplaceName: "bb-official",
  publisherLabel: "BB Official",
  hasSettings: true,
  marketplacePageUrl: pageLink("agent-annotations"),
};

const LINK_BUILTIN_RENAMED: PluginListItem = {
  ...BUNDLED_PLUGIN,
  id: "simple-notes",
  name: "Simple Notes",
  description: "Keep markdown notes next to your threads.",
  icon: "FileText",
  source: "builtin:docs",
  rootDir: "/managed/plugins/docs",
  marketplacePageUrl: pageLink("simple-notes"),
};

const LINK_BUILTIN_UNLISTED: PluginListItem = {
  ...BUNDLED_PLUGIN,
  id: "provider-codex",
  name: "Codex",
  description: "Run threads with OpenAI Codex.",
  icon: "Bot",
  source: "builtin:provider-codex",
  rootDir: "/managed/plugins/provider-codex",
  hasSettings: true,
  marketplacePageUrl: null,
};

const LINK_COMMUNITY_INSTALLED: PluginListItem = {
  ...PLUGIN,
  id: "github-community-link",
  name: "Linear Sync",
  description: LINK_COMMUNITY_ENTRY.description,
  icon: "Link",
  source: "catalog:bb-community/linear-sync",
  provenance: "catalog",
  catalogEntryId: "linear-sync",
  catalogMarketplaceName: "bb-community",
  publisherLabel: "BB Community",
  marketplacePageUrl: pageLink("linear-sync"),
};

const LINK_FOLDER_PLUGIN: PluginListItem = {
  ...PLUGIN,
  id: "standup-notes",
  name: "Standup Notes",
  description: "Drafts a standup from yesterday's threads.",
  icon: "FileText",
  source: "path:/Users/you/code/standup-notes",
  rootDir: "/Users/you/code/standup-notes",
  sourceDisplay: "path · ~/code/standup-notes",
  hasSettings: true,
  marketplacePageUrl: null,
};

function StoryWidths({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <StoryFrame label="Desktop">{children}</StoryFrame>
      <StoryFrame label="Phone · 390px" phone>
        {children}
      </StoryFrame>
    </div>
  );
}

function StoryFrame({
  label,
  phone = false,
  children,
}: {
  label: string;
  phone?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-2xs font-medium text-subtle-foreground">{label}</p>
      <div
        className={
          phone
            ? "max-h-56 w-[390px] max-w-full overflow-hidden rounded-md border border-border bg-background px-4"
            : "max-h-56 overflow-hidden rounded-md border border-border bg-background px-5"
        }
      >
        {children}
      </div>
    </div>
  );
}

export function PluginCopyLinkStates() {
  return (
    <PluginStoryQueryBoundary>
      <Story
        title="Plugin copy link states"
        description="Every plugin with a getbb.app page gets a Copy link icon button. Catalog pages: Copy link, Install, ⋯ (hidden when empty). Installed pages: Settings and Copy link as one icon group, a divider, then the switch and ⋯. Clicking copies the page link on every device and shows “Link copied”. Plugins with no page show no Copy link, and ⋯ no longer has Copy marketplace link."
        renderedNote="The real header, at desktop and phone widths (page clipped below the header)"
      >
        <State
          name="Catalog · Install"
          note="Uninstalled BB Official plugin with a page. Copy link sits left of Install, which stays the only labeled button. ⋯ is hidden because it has nothing left to offer."
        >
          <StoryWidths>
            <CatalogPlugin entry={LINK_CATALOG_ENTRY} />
          </StoryWidths>
        </State>

        <State
          name="Catalog · installing"
          note="Install progress replaces Install in place. Copy link stays put, so the header doesn't shift while the install runs."
        >
          <StoryWidths>
            <CatalogPlugin entry={LINK_INSTALLING_ENTRY} />
          </StoryWidths>
        </State>

        <State
          name="Catalog · BB Community"
          note="A community plugin with an install count. The byline names its author; Copy link points at its getbb.app page."
        >
          <StoryWidths>
            <CatalogPlugin entry={LINK_COMMUNITY_ENTRY} />
          </StoryWidths>
        </State>

        <State
          name="Catalog · install unavailable"
          note="Install is disabled by a compatibility blocker. Copy link still works: the page exists even when this bb can't install it."
        >
          <StoryWidths>
            <CatalogPlugin
              entry={{
                ...LINK_CATALOG_ENTRY,
                compatible: false,
                incompatibleReason: "Requires bb 0.50 or newer.",
              }}
            />
          </StoryWidths>
        </State>

        <State
          name="Catalog · no page"
          note="One of the nine unlisted official plugins (providers, environments, account-pool, plugin-api-tester). No Copy link and no ⋯ menu."
        >
          <StoryWidths>
            <CatalogPlugin entry={LINK_UNLISTED_ENTRY} />
          </StoryWidths>
        </State>

        <State
          name="Installed · BB Official"
          note="Catalog install with settings. Settings and Copy link form one icon group, then a divider, the enable switch, and ⋯ (Uninstall)."
        >
          <StoryWidths>
            <Plugin plugin={LINK_OFFICIAL_INSTALLED} />
          </StoryWidths>
        </State>

        <State
          name="Installed · built-in, renamed"
          note="Ships with bb, so Uninstall in ⋯ is disabled. Its built-in name (docs) differs from its plugin ID and page (simple-notes); the server-filled link points at the page."
        >
          <StoryWidths>
            <Plugin plugin={LINK_BUILTIN_RENAMED} />
          </StoryWidths>
        </State>

        <State
          name="Installed · BB Community"
          note="Community catalog install without settings: Copy link, divider, switch, ⋯."
        >
          <StoryWidths>
            <Plugin plugin={LINK_COMMUNITY_INSTALLED} />
          </StoryWidths>
        </State>

        <State
          name="Installed · no page"
          note="An unlisted built-in plugin. No Copy link; the group holds only Settings, then the divider, switch, and ⋯."
        >
          <StoryWidths>
            <Plugin plugin={LINK_BUILTIN_UNLISTED} />
          </StoryWidths>
        </State>

        <State
          name="Folder install · stage 2"
          note="Installed from a local folder. No Copy link in stage 2: a matching ID alone could be someone else's plugin. With no settings either, there is no icon group or divider. ⋯ has Edit and Remove from bb; Open source and Copy path stay in the Source section."
        >
          <StoryWidths>
            <Plugin plugin={LINK_FOLDER_PLUGIN} />
          </StoryWidths>
        </State>

      </Story>
    </PluginStoryQueryBoundary>
  );
}

function cardEntry(
  entryId: string,
  displayName: string,
  overrides: Partial<PluginCatalogSearchEntry> = {},
): PluginCatalogSearchEntry {
  return {
    ...LINK_CATALOG_ENTRY,
    entryId,
    pluginId: entryId,
    displayName,
    description: `${displayName} for bb.`,
    source: `builtin:${entryId}`,
    marketplacePageUrl: pageLink(entryId),
    ...overrides,
  };
}

function cardInstalledPlugin(
  entry: PluginCatalogSearchEntry,
  enabled: boolean,
): InstalledPlugin {
  return makeInstalledPlugin({
    id: entry.pluginId,
    name: entry.displayName,
    description: entry.description,
    source: entry.source,
    rootDir: `/managed/plugins/${entry.pluginId}`,
    provenance: entry.source.startsWith("builtin:") ? "builtin" : "catalog",
    catalogEntryId: entry.entryId,
    catalogMarketplaceName: entry.marketplace,
    publisherLabel: entry.publisherLabel,
    enabled,
    status: enabled ? "running" : "disabled",
  });
}

function cardJob(
  entry: PluginCatalogSearchEntry,
  state: "queued" | "running" | "cancelling",
): PluginInstallJob {
  return {
    id: `job-${entry.entryId}`,
    target: {
      kind: "catalog",
      entryId: entry.entryId,
      marketplace: entry.marketplace,
    },
    displayName: entry.displayName,
    state,
  };
}

const CARD_INSTALL = cardEntry("card-install", "Agent Annotations");
const CARD_INSTALL_COUNT = cardEntry("card-install-count", "Linear Sync", {
  installs: 1240,
  source: "npm:linear-sync-bb",
});
const CARD_QUEUED = cardEntry("card-queued", "Git");
const CARD_RUNNING = cardEntry("card-running", "Browser Automation");
const CARD_CANCELLING = cardEntry("card-cancelling", "Memory");
const CARD_UNAVAILABLE = cardEntry("card-unavailable", "Tasks", {
  compatible: false,
  incompatibleReason: "Requires bb 0.50 or newer.",
});
const CARD_INSTALLED_ON = cardEntry("card-installed-on", "Workflows", {
  installed: true,
  source: "catalog:bb-official/card-installed-on",
});
const CARD_INSTALLED_OFF = cardEntry("card-installed-off", "Side Chat", {
  installed: true,
  source: "catalog:bb-official/card-installed-off",
});
const CARD_INCLUDED = cardEntry("card-included", "Navigation", {
  installed: true,
  installedByDefault: true,
});
const CARD_LIFECYCLE = cardEntry("card-lifecycle", "Theme Preview");

const CARD_STATIC_JOBS: PluginInstallJob[] = [
  cardJob(CARD_QUEUED, "queued"),
  cardJob(CARD_RUNNING, "running"),
  cardJob(CARD_CANCELLING, "cancelling"),
];

const CARD_STATIC_PLUGINS: InstalledPlugin[] = [
  cardInstalledPlugin(CARD_INSTALLED_ON, true),
  cardInstalledPlugin(CARD_INSTALLED_OFF, false),
  cardInstalledPlugin(CARD_INCLUDED, true),
];

function readRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function useStoryPluginToggleFetch() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const match =
        /\/api\/v1\/plugins\/([^/?]+)\/(enable|disable)(?:\?|$)/.exec(
          readRequestUrl(input),
        );
      if (match === null) return originalFetch.call(globalThis, input, init);
      const pluginId = decodeURIComponent(match[1] ?? "");
      const enabled = match[2] === "enable";
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      const plugins =
        queryClient.getQueryData<InstalledPlugin[]>(pluginListQueryKey(true)) ??
        [];
      const next = plugins.map((plugin) =>
        plugin.id === pluginId
          ? {
              ...plugin,
              enabled,
              status: enabled ? ("running" as const) : ("disabled" as const),
            }
          : plugin,
      );
      queryClient.setQueryData(pluginListQueryKey(true), next);
      const updated = next.find((plugin) => plugin.id === pluginId);
      return new Response(JSON.stringify({ plugin: updated }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    return () => {
      globalThis.fetch = originalFetch;
    };
  }, [queryClient]);
}

function CardStoryQueryBoundary({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          refetchOnMount: false,
          refetchOnReconnect: false,
          refetchOnWindowFocus: false,
          staleTime: Number.POSITIVE_INFINITY,
        },
      },
    });
    client.setQueryData(pluginInstallJobsQueryKey(), CARD_STATIC_JOBS);
    client.setQueryData(pluginListQueryKey(true), CARD_STATIC_PLUGINS);
    return client;
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function StoryCard({ entry }: { entry: PluginCatalogSearchEntry }) {
  return (
    <div className="max-w-sm">
      <PluginCardGrid>
        <PluginCatalogCard
          entry={entry}
          onInstall={noop}
          onUninstall={noop}
          onOpenPlugin={noop}
        />
      </PluginCardGrid>
    </div>
  );
}

function CardLifecycle() {
  const queryClient = useQueryClient();
  const [entry, setEntry] = useState(CARD_LIFECYCLE);
  useStoryPluginToggleFetch();

  const setJobs = (jobs: PluginInstallJob[]) =>
    queryClient.setQueryData(pluginInstallJobsQueryKey(), [
      ...CARD_STATIC_JOBS,
      ...jobs,
    ]);

  const install = () => {
    setJobs([cardJob(entry, "queued")]);
    window.setTimeout(() => setJobs([cardJob(entry, "running")]), 1_200);
    window.setTimeout(() => {
      setJobs([]);
      queryClient.setQueryData(pluginListQueryKey(true), [
        ...CARD_STATIC_PLUGINS,
        cardInstalledPlugin(entry, true),
      ]);
      setEntry((current) => ({ ...current, installed: true }));
    }, 3_600);
  };

  const reset = () => {
    setJobs([]);
    queryClient.setQueryData(pluginListQueryKey(true), CARD_STATIC_PLUGINS);
    setEntry(CARD_LIFECYCLE);
  };

  return (
    <div className="flex items-start gap-4">
      <div className="max-w-sm flex-1">
        <PluginCardGrid>
          <PluginCatalogCard
            entry={entry}
            onInstall={install}
            onUninstall={reset}
            onOpenPlugin={noop}
          />
        </PluginCardGrid>
      </div>
      <button
        type="button"
        className="text-xs text-muted-foreground underline"
        onClick={reset}
      >
        Reset
      </button>
    </div>
  );
}

export function PluginCardInstallStates() {
  return (
    <CardStoryQueryBoundary>
      <Story
        title="Plugin card install states"
        description="The Browse card's footer moves from Install, through install progress, to Installed with the enable switch beside it. Click Install on the first card to run the whole sequence; the switch then turns the plugin on and off. Cards carry no Copy link; it lives in the plugin page header."
        renderedNote="The real Browse card"
      >
        <State
          name="Lifecycle"
          note="Install → Queued → Installing… → Installed with the switch on. Toggle the switch to disable and re-enable it. Reset (or clicking Installed) starts over."
        >
          <CardLifecycle />
        </State>

        <State
          name="Install"
          note="Uninstalled and installable. Subtle Install control in the footer."
        >
          <StoryCard entry={CARD_INSTALL} />
        </State>

        <State
          name="Install · with count"
          note="Community plugins show their install count inside the control."
        >
          <StoryCard entry={CARD_INSTALL_COUNT} />
        </State>

        <State
          name="Queued"
          note="Waiting for another install. Hover shows ✕; clicking cancels."
        >
          <StoryCard entry={CARD_QUEUED} />
        </State>

        <State
          name="Installing"
          note="Install running. Hover shows ✕; clicking cancels."
        >
          <StoryCard entry={CARD_RUNNING} />
        </State>

        <State
          name="Cancelling"
          note="Cancel requested; the control is inert until the job ends."
        >
          <StoryCard entry={CARD_CANCELLING} />
        </State>

        <State
          name="Install unavailable"
          note="This bb can't install it; the tooltip names the requirement."
        >
          <StoryCard entry={CARD_UNAVAILABLE} />
        </State>

        <State
          name="Installed · on"
          note="Installed control (hover to uninstall) with the enable switch on."
        >
          <StoryCard entry={CARD_INSTALLED_ON} />
        </State>

        <State
          name="Installed · off"
          note="Still installed, runtime disabled: the switch is off."
        >
          <StoryCard entry={CARD_INSTALLED_OFF} />
        </State>

        <State
          name="Included with bb"
          note="Ships with bb, so the Installed control can't uninstall; the switch still turns it off."
        >
          <StoryCard entry={CARD_INCLUDED} />
        </State>
      </Story>
    </CardStoryQueryBoundary>
  );
}
