import { SURFACE_DOCS_BASE_PATH } from "../../../../plugins/plugin-api-docs/src/surface-docs";
import { DISCORD_URL, GITHUB_URL } from "../landing/site";

export const DOCS_NAV_ICONS = [
  "get-started",
  "concepts",
  "threads",
  "child-threads",
  "automations",
  "agents",
  "skills",
  "projects",
  "machines",
  "mobile",
  "plugins",
  "customization",
  "reference",
  "troubleshooting",
  "community",
] as const;

export type DocsNavIcon = (typeof DOCS_NAV_ICONS)[number];

interface DocsNavPage {
  title: string;
  slug: string;
  navLabel: string;
}

interface DocsNavSectionPlan {
  label: string;
  icon: DocsNavIcon;
  pages: DocsNavPage[];
}

interface DocsNavExternalLink {
  title: string;
  href: string;
}

function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function page(
  title: string,
  slug = slugFromTitle(title),
  navLabel = title,
): DocsNavPage {
  return { title, slug, navLabel };
}

export const DOCS_NAV: readonly DocsNavSectionPlan[] = [
  {
    label: "Get started",
    icon: "get-started",
    pages: [
      page("What is bb", "", "Overview"),
      page("Install bb", "install", "Install"),
      page("Connect your agents", "connect-your-agents", "Connect agents"),
      page(
        "Quickstart: delegate work to child threads",
        "quickstart-delegate-work",
        "Quickstart",
      ),
      page(
        "Switch from another tool",
        "switch-from-another-tool",
        "Switch to bb",
      ),
    ],
  },
  {
    label: "Concepts",
    icon: "concepts",
    pages: [
      page(
        "Projects, threads and environments",
        "projects-threads-and-environments",
        "Projects and threads",
      ),
      page(
        "Machines, servers and the host daemon",
        "machines-servers-and-the-host-daemon",
        "Machines and servers",
      ),
      page(
        "Child threads, subagents and workflows",
        "child-threads-subagents-and-workflows",
        "Child threads",
      ),
      page("Agent context", "agent-context"),
      page(
        "Security, privacy and teams",
        "security-privacy-and-teams",
        "Security",
      ),
    ],
  },
  {
    label: "Threads",
    icon: "threads",
    pages: [
      page(
        "Send, steer and queue messages",
        "send-steer-and-queue-messages",
        "Messages",
      ),
      page(
        "Fork, hand off or switch models",
        "fork-hand-off-or-switch-models",
        "Fork and hand off",
      ),
      page(
        "Choose a permission mode",
        "choose-a-permission-mode",
        "Permissions",
      ),
      page(
        "View diffs and pull requests",
        "view-diffs-and-pull-requests",
        "Diffs and PRs",
      ),
      page(
        "Open files, previews and links",
        "open-files-previews-and-links",
        "Files and previews",
      ),
      page(
        "Let agents use a browser or your computer",
        "let-agents-use-a-browser",
        "Browser",
      ),
      page(
        "Get notified when a thread needs you",
        "get-notified",
        "Notifications",
      ),
      page(
        "Organize and archive threads",
        "organize-and-archive-threads",
        "Organize threads",
      ),
      page(
        "Dictate messages with voice",
        "dictate-messages-with-voice",
        "Voice",
      ),
    ],
  },
  {
    label: "Child threads",
    icon: "child-threads",
    pages: [
      page("Start child threads", "start-child-threads", "Start children"),
      page(
        "Follow child threads from the parent",
        "follow-child-threads-from-the-parent",
        "Follow children",
      ),
      page(
        "Run an orchestrator thread",
        "run-an-orchestrator-thread",
        "Orchestrators",
      ),
    ],
  },
  {
    label: "Automations",
    icon: "automations",
    pages: [
      page("Schedule an automation", "schedule-an-automation", "Schedules"),
      page("Run a workflow", "run-a-workflow", "Workflows"),
      page(
        "Plan and track work with Tasks",
        "plan-and-track-work-with-tasks",
        "Tasks",
      ),
    ],
  },
  {
    label: "Agents",
    icon: "agents",
    pages: [
      page("Claude Code"),
      page("Codex"),
      page("Pi"),
      page(
        "Add Cursor, opencode and other ACP agents",
        "add-acp-agents",
        "ACP agents",
      ),
      page(
        "Choose a model, reasoning and context size",
        "choose-a-model-reasoning-and-context-size",
        "Models",
      ),
      page("Use several accounts", "use-several-accounts", "Accounts"),
      page(
        "Track usage, limits and cost",
        "track-usage-limits-and-cost",
        "Usage and cost",
      ),
      page("Connect MCP servers", "connect-mcp-servers", "MCP servers"),
    ],
  },
  {
    label: "Skills",
    icon: "skills",
    pages: [
      page("Add and share skills", "add-and-share-skills", "Add skills"),
      page("Use skills in a thread", "use-skills-in-a-thread", "Use skills"),
    ],
  },
  {
    label: "Projects",
    icon: "projects",
    pages: [
      page("Set up a project", "set-up-a-project", "Project setup"),
      page(
        "Choose where a thread runs",
        "choose-where-a-thread-runs",
        "Where threads run",
      ),
      page(
        "Run threads in sandboxes, containers and VMs",
        "run-threads-in-sandboxes",
        "Sandboxes",
      ),
    ],
  },
  {
    label: "Machines and servers",
    icon: "machines",
    pages: [
      page("Add a machine", "add-a-machine"),
      page(
        "Run bb on an always-on machine",
        "run-bb-on-an-always-on-machine",
        "Always-on machine",
      ),
      page("Run several servers", "run-several-servers", "Several servers"),
      page(
        "Move your server to another machine",
        "move-your-server-to-another-machine",
        "Move your server",
      ),
    ],
  },
  {
    label: "Mobile and remote",
    icon: "mobile",
    pages: [
      page("Use bb on your phone", "use-bb-on-your-phone", "Phone"),
      page("Set up remote access", "set-up-remote-access", "Remote access"),
    ],
  },
  {
    label: "Plugins",
    icon: "plugins",
    pages: [
      page(
        "Find and install plugins",
        "find-and-install-plugins",
        "Install plugins",
      ),
      page(
        "Quickstart: build your first plugin",
        "quickstart-build-a-plugin",
        "Build a plugin",
      ),
      page(
        "Publish to the marketplace",
        "publish-to-the-marketplace",
        "Publish a plugin",
      ),
    ],
  },
  {
    label: "Customization",
    icon: "customization",
    pages: [
      page(
        "Change the theme and layout",
        "change-the-theme-and-layout",
        "Theme and layout",
      ),
      page(
        "Change keyboard shortcuts",
        "change-keyboard-shortcuts",
        "Shortcuts",
      ),
      page(
        "Name threads and branches",
        "name-threads-and-branches",
        "Thread names",
      ),
    ],
  },
  {
    label: "Reference",
    icon: "reference",
    pages: [
      page("CLI", "cli"),
      page("Keyboard shortcuts", "keyboard-shortcuts", "Keyboard"),
      page("Settings", "settings"),
      page(
        "Configuration files and environment variables",
        "configuration-files-and-environment-variables",
        "Config files",
      ),
      page("Platform support", "platform-support", "Platforms"),
      page("Agent feature support", "agent-feature-support", "Agent features"),
      page("Plugin SDK", "plugin-sdk"),
      page("Glossary", "glossary"),
    ],
  },
  {
    label: "Troubleshooting",
    icon: "troubleshooting",
    pages: [
      page("Find your problem", "find-your-problem"),
      page(
        "bb is slow or uses a lot of memory",
        "bb-is-slow-or-uses-a-lot-of-memory",
        "Slow or high memory",
      ),
      page(
        "bb won't install, update or start",
        "bb-wont-install-update-or-start",
        "Install and updates",
      ),
      page(
        "An agent won't sign in or can't be found",
        "an-agent-wont-sign-in-or-cant-be-found",
        "Sign-in problems",
      ),
      page(
        "A model is missing from the model picker",
        "a-model-is-missing-from-the-model-picker",
        "Missing model",
      ),
      page(
        "A skill is missing from the / menu",
        "a-skill-is-missing-from-the-menu",
        "Missing skill",
      ),
      page(
        "A plugin won't install or load",
        "a-plugin-wont-install-or-load",
        "Plugin problems",
      ),
      page(
        "A thread, environment or automation is stuck",
        "a-thread-environment-or-automation-is-stuck",
        "Stuck threads",
      ),
      page(
        "bb connect drops or won't connect",
        "bb-connect-drops-or-wont-connect",
        "bb connect",
      ),
    ],
  },
];

export const DOCS_NAV_COMMUNITY: {
  label: string;
  icon: DocsNavIcon;
  links: readonly DocsNavExternalLink[];
} = {
  label: "Community",
  icon: "community",
  links: [
    { title: "Ask a question", href: DISCORD_URL },
    {
      title: "Report a bug",
      href: `${GITHUB_URL}/issues/new?template=bug.yml`,
    },
    {
      title: "Request a feature",
      href: `${GITHUB_URL}/issues/new?template=feature.yml`,
    },
    {
      title: "Report a security issue",
      href: `${GITHUB_URL}/blob/main/SECURITY.md`,
    },
    {
      title: "Contribute to bb",
      href: `${GITHUB_URL}/blob/main/CONTRIBUTING.md`,
    },
  ],
};

export const PLUGIN_SDK_SLUG = SURFACE_DOCS_BASE_PATH.replace(/^\/docs\//u, "");

export function navSectionOf(slug: string): string | null {
  const owner = slug.startsWith(`${PLUGIN_SDK_SLUG}/`) ? PLUGIN_SDK_SLUG : slug;
  return (
    DOCS_NAV.find((section) =>
      section.pages.some((candidate) => candidate.slug === owner),
    )?.label ?? null
  );
}
