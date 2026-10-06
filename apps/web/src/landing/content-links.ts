export interface ContentLink {
  label: string;
  href: string;
}

export const GUIDE_LINKS: ContentLink[] = [
  {
    label: "Run a dev server for every branch",
    href: "/guides/remote-dev-servers",
  },
  {
    label: "Use Claude Code and Codex together",
    href: "/guides/claude-code-and-codex-together",
  },
];

export const COMPARE_LINKS: ContentLink[] = [
  { label: "bb vs Conductor", href: "/compare/conductor-alternatives" },
  { label: "bb vs Cursor", href: "/compare/cursor-alternative" },
  { label: "bb vs Superset", href: "/compare/superset-alternative" },
  { label: "bb vs T3 Code", href: "/compare/t3-code-alternatives" },
  { label: "bb vs Vibe Kanban", href: "/compare/vibe-kanban-alternative" },
];

export const CONTENT_PATHS: string[] = [...GUIDE_LINKS, ...COMPARE_LINKS].map(
  (link) => link.href,
);
