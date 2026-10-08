export interface ContentLink {
  label: string;
  href: string;
}

export interface ContentGroup {
  label: string;
  links: ContentLink[];
}

const SCHEDULE_GUIDE: ContentLink = {
  label: "Run an agent on a schedule",
  href: "/guides/run-an-agent-on-a-schedule",
};
const DEV_SERVER_GUIDE: ContentLink = {
  label: "Run a dev server for every branch",
  href: "/guides/remote-dev-servers",
};
const ANYWHERE_GUIDE: ContentLink = {
  label: "Keep working from anywhere",
  href: "/guides/work-from-anywhere",
};
const CODEX_GUIDE: ContentLink = {
  label: "Use Claude Code and Codex together",
  href: "/guides/claude-code-and-codex-together",
};
const ORCHESTRATE_GUIDE: ContentLink = {
  label: "Orchestrate your coding agents",
  href: "/guides/orchestrate-coding-agents",
};
const SWITCH_GUIDE: ContentLink = {
  label: "Switch to bb",
  href: "/guides/switch-to-bb",
};
const BROWSER_GUIDE: ContentLink = {
  label: "Let your coding agent use a browser",
  href: "/guides/agent-browser",
};
const BROWSER_WORK_GUIDE: ContentLink = {
  label: "Have an agent do your browser work",
  href: "/guides/agent-browser-for-work",
};

export const GUIDE_LINKS: ContentLink[] = [
  SCHEDULE_GUIDE,
  DEV_SERVER_GUIDE,
  ANYWHERE_GUIDE,
  ORCHESTRATE_GUIDE,
  SWITCH_GUIDE,
  BROWSER_GUIDE,
  BROWSER_WORK_GUIDE,
];

function menuLink(link: ContentLink, label: string): ContentLink {
  return { href: link.href, label };
}

export const GUIDE_MENU: (ContentGroup | ContentLink)[] = [
  menuLink(ORCHESTRATE_GUIDE, "Orchestrate agents"),
  {
    label: "Automation",
    links: [
      menuLink(SCHEDULE_GUIDE, "Schedule agents"),
      menuLink(BROWSER_GUIDE, "Test in a browser"),
      menuLink(BROWSER_WORK_GUIDE, "Do browser work"),
    ],
  },
  {
    label: "Remote & mobile",
    links: [
      menuLink(DEV_SERVER_GUIDE, "Run dev servers"),
      menuLink(ANYWHERE_GUIDE, "Work from anywhere"),
    ],
  },
  SWITCH_GUIDE,
];

export const COMPARE_LINKS: ContentLink[] = [
  { label: "bb vs Conductor", href: "/compare/conductor-alternatives" },
  { label: "bb vs Cursor", href: "/compare/cursor-alternative" },
  { label: "bb vs Superset", href: "/compare/superset-alternative" },
  { label: "bb vs T3 Code", href: "/compare/t3-code-alternatives" },
  { label: "bb vs Vibe Kanban", href: "/compare/vibe-kanban-alternative" },
];

export const LANDING_LINKS: ContentLink[] = [
  { label: "Claude Code on your phone", href: "/claude-code-mobile" },
  { label: "Claude Code with Codex", href: "/claude-code-and-codex" },
  { label: "Parallel coding agents", href: "/claude-code-parallel-agents" },
];

export const LANDING_PATHS: string[] = LANDING_LINKS.map((link) => link.href);

const SITEMAP_ONLY_LINKS: ContentLink[] = [CODEX_GUIDE];

export const CONTENT_PATHS: string[] = [
  ...[...GUIDE_LINKS, ...SITEMAP_ONLY_LINKS, ...COMPARE_LINKS].map(
    (link) => link.href,
  ),
  ...LANDING_PATHS,
];
