interface DocsNavPage {
  title: string;
  slug: string;
}

interface DocsNavSectionPlan {
  label: string;
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

function page(title: string, slug = slugFromTitle(title)): DocsNavPage {
  return { title, slug };
}

export const DOCS_NAV: readonly DocsNavSectionPlan[] = [
  {
    label: "Get started",
    pages: [
      page("What is bb", ""),
      page("Install bb", "install"),
      page("Connect your agents", "connect-your-agents"),
      page(
        "Quickstart: delegate work to child threads",
        "quickstart-delegate-work",
      ),
      page("Switch from another tool", "switch-from-another-tool"),
    ],
  },
  {
    label: "Concepts",
    pages: [
      page(
        "Projects, threads and environments",
        "projects-threads-and-environments",
      ),
      page(
        "Machines, servers and the host daemon",
        "machines-servers-and-the-host-daemon",
      ),
      page(
        "Child threads, subagents and workflows",
        "child-threads-subagents-and-workflows",
      ),
      page("Agent context", "agent-context"),
      page("Security, privacy and teams", "security-privacy-and-teams"),
    ],
  },
  {
    label: "Threads",
    pages: [
      page("Send, steer and queue messages", "send-steer-and-queue-messages"),
      page("Fork, hand off or switch models", "fork-hand-off-or-switch-models"),
      page("Choose a permission mode", "choose-a-permission-mode"),
      page("View diffs and pull requests", "view-diffs-and-pull-requests"),
      page("Open files, previews and links", "open-files-previews-and-links"),
      page(
        "Let agents use a browser or your computer",
        "let-agents-use-a-browser",
      ),
      page("Get notified when a thread needs you", "get-notified"),
      page("Organize and archive threads", "organize-and-archive-threads"),
      page("Dictate messages with voice", "dictate-messages-with-voice"),
    ],
  },
  {
    label: "Child threads",
    pages: [
      page("Start child threads", "start-child-threads"),
      page(
        "Follow child threads from the parent",
        "follow-child-threads-from-the-parent",
      ),
      page("Run an orchestrator thread", "run-an-orchestrator-thread"),
    ],
  },
  {
    label: "Automations, workflows and tasks",
    pages: [
      page("Schedule an automation", "schedule-an-automation"),
      page("Run a workflow", "run-a-workflow"),
      page("Plan and track work with Tasks", "plan-and-track-work-with-tasks"),
    ],
  },
  {
    label: "Agents",
    pages: [
      page("Claude Code"),
      page("Codex"),
      page("Pi"),
      page("Add Cursor, opencode and other ACP agents", "add-acp-agents"),
      page(
        "Choose a model, reasoning and context size",
        "choose-a-model-reasoning-and-context-size",
      ),
      page("Use several accounts", "use-several-accounts"),
      page("Track usage, limits and cost", "track-usage-limits-and-cost"),
      page("Connect MCP servers", "connect-mcp-servers"),
    ],
  },
  {
    label: "Skills",
    pages: [
      page("Add and share skills", "add-and-share-skills"),
      page("Use skills in a thread", "use-skills-in-a-thread"),
    ],
  },
  {
    label: "Projects and environments",
    pages: [
      page("Set up a project", "set-up-a-project"),
      page("Choose where a thread runs", "choose-where-a-thread-runs"),
      page(
        "Run threads in sandboxes, containers and VMs",
        "run-threads-in-sandboxes",
      ),
    ],
  },
  {
    label: "Machines and servers",
    pages: [
      page("Add a machine", "add-a-machine"),
      page("Run bb on an always-on machine", "run-bb-on-an-always-on-machine"),
      page("Run several servers", "run-several-servers"),
      page(
        "Move your server to another machine",
        "move-your-server-to-another-machine",
      ),
    ],
  },
  {
    label: "Mobile and remote access",
    pages: [
      page("Use bb on your phone", "use-bb-on-your-phone"),
      page("Set up remote access", "set-up-remote-access"),
    ],
  },
  {
    label: "Plugins",
    pages: [
      page("Find and install plugins", "find-and-install-plugins"),
      page("Quickstart: build your first plugin", "quickstart-build-a-plugin"),
      page("Publish to the marketplace", "publish-to-the-marketplace"),
    ],
  },
  {
    label: "Customization",
    pages: [
      page("Change the theme and layout", "change-the-theme-and-layout"),
      page("Change keyboard shortcuts", "change-keyboard-shortcuts"),
      page("Name threads and branches", "name-threads-and-branches"),
    ],
  },
  {
    label: "Reference",
    pages: [
      page("CLI", "cli"),
      page("Keyboard shortcuts", "keyboard-shortcuts"),
      page("Settings", "settings"),
      page(
        "Configuration files and environment variables",
        "configuration-files-and-environment-variables",
      ),
      page("Platform support", "platform-support"),
      page("Agent feature support", "agent-feature-support"),
      page("Plugin SDK", "plugin-sdk"),
      page("Glossary", "glossary"),
    ],
  },
  {
    label: "Troubleshooting",
    pages: [
      page("Find your problem", "find-your-problem"),
      page(
        "bb is slow or uses a lot of memory",
        "bb-is-slow-or-uses-a-lot-of-memory",
      ),
      page(
        "bb won't install, update or start",
        "bb-wont-install-update-or-start",
      ),
      page(
        "An agent won't sign in or can't be found",
        "an-agent-wont-sign-in-or-cant-be-found",
      ),
      page(
        "A model is missing from the model picker",
        "a-model-is-missing-from-the-model-picker",
      ),
      page(
        "A skill is missing from the / menu",
        "a-skill-is-missing-from-the-menu",
      ),
      page("A plugin won't install or load", "a-plugin-wont-install-or-load"),
      page(
        "A thread, environment or automation is stuck",
        "a-thread-environment-or-automation-is-stuck",
      ),
      page(
        "bb Connect drops or won't connect",
        "bb-connect-drops-or-wont-connect",
      ),
    ],
  },
];

export const DOCS_NAV_FOOTER_LINKS: readonly DocsNavExternalLink[] = [
  { title: "What's new", href: "/changelog" },
  {
    title: "Contribute to bb",
    href: "https://github.com/get-bb/bb/blob/main/CONTRIBUTING.md",
  },
];

export function navSectionOf(slug: string): string | null {
  return (
    DOCS_NAV.find((section) =>
      section.pages.some((candidate) => candidate.slug === slug),
    )?.label ?? null
  );
}
