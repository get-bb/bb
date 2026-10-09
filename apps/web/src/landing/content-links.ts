import type { CompareMeta } from "../compare/compare-types";
import type { GuideMeta } from "../guides/guide-types";
import type { LandingMeta } from "./landing-template";

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

const COMPARE_METAS: CompareMeta[] = Object.values(
  import.meta.glob<CompareMeta>("../compare/pages/*.tsx", {
    eager: true,
    import: "meta",
  }),
).filter((meta): meta is CompareMeta => meta !== undefined);

export const COMPARE_LINKS: ContentLink[] = COMPARE_METAS.map((meta) => ({
  label: `bb vs ${meta.competitor.name}`,
  href: `/compare/${meta.slug}`,
})).sort((a, b) => a.label.localeCompare(b.label));

const LANDING_METAS: LandingMeta[] = Object.values(
  import.meta.glob<LandingMeta>("./pages/*.tsx", {
    eager: true,
    import: "meta",
  }),
).filter((meta): meta is LandingMeta => meta !== undefined);

export const LANDING_LINKS: ContentLink[] = LANDING_METAS.map((meta) => ({
  label: meta.label,
  href: `/${meta.slug}`,
})).sort((a, b) => a.label.localeCompare(b.label));

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
