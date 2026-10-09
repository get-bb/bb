import type { GuideMeta } from "../guides/guide-types";

export interface ContentLink {
  label: string;
  href: string;
}

export interface ContentGroup {
  label: string;
  links: ContentLink[];
}

const GUIDE_METAS: GuideMeta[] = Object.values(
  import.meta.glob<GuideMeta>("../guides/pages/*.tsx", {
    eager: true,
    import: "meta",
  }),
).filter((meta): meta is GuideMeta => meta !== undefined);

function guidePath(meta: GuideMeta): string {
  return `/guides/${meta.slug}`;
}

const NAV_GUIDES = GUIDE_METAS.flatMap((meta) =>
  meta.nav ? [{ meta, nav: meta.nav }] : [],
).sort((a, b) => a.nav.order - b.nav.order);

export const GUIDE_LINKS: ContentLink[] = NAV_GUIDES.map(({ meta }) => ({
  label: meta.title,
  href: guidePath(meta),
}));

export const GUIDE_FOOTER_LINKS: ContentLink[] = NAV_GUIDES.map(
  ({ meta, nav }) => ({ label: nav.label, href: guidePath(meta) }),
);

export const GUIDE_MENU: (ContentGroup | ContentLink)[] = NAV_GUIDES.reduce<
  (ContentGroup | ContentLink)[]
>((menu, { meta, nav }) => {
  const link = { label: nav.label, href: guidePath(meta) };
  if (nav.group === null) {
    return [...menu, link];
  }
  const existing = menu.find(
    (item): item is ContentGroup => "links" in item && item.label === nav.group,
  );
  if (existing) {
    existing.links.push(link);
    return menu;
  }
  return [...menu, { label: nav.group, links: [link] }];
}, []);

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

export const CANONICAL_PATHS: Record<string, string> = Object.fromEntries(
  GUIDE_METAS.flatMap((meta) =>
    meta.canonical ? [[guidePath(meta), meta.canonical]] : [],
  ),
);

export function canonicalPath(path: string): string {
  return CANONICAL_PATHS[path] ?? path;
}

export const CONTENT_PATHS: string[] = [
  ...GUIDE_METAS.filter((meta) => meta.canonical === null).map(guidePath),
  ...COMPARE_LINKS.map((link) => link.href),
  ...LANDING_PATHS,
];
