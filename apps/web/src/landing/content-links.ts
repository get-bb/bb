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

interface MetaModule<T> {
  meta?: T;
}

const GUIDE_MODULES = import.meta.glob<MetaModule<GuideMeta>>(
  "../guides/pages/*.tsx",
  { eager: true },
);
const COMPARE_MODULES = import.meta.glob<MetaModule<CompareMeta>>(
  "../compare/pages/*.tsx",
  { eager: true },
);
const LANDING_MODULES = import.meta.glob<MetaModule<LandingMeta>>(
  "./pages/*.tsx",
  { eager: true },
);

function metas<T>(modules: Record<string, MetaModule<T>>): T[] {
  return Object.values(modules).flatMap((module) =>
    module.meta ? [module.meta] : [],
  );
}

function once<T>(build: () => T): () => T {
  let value: { built: T } | null = null;
  return () => {
    value ??= { built: build() };
    return value.built;
  };
}

function guidePath(meta: GuideMeta): string {
  return `/guides/${meta.slug}`;
}

const navGuides = once(() =>
  metas(GUIDE_MODULES)
    .flatMap((meta) => (meta.nav ? [{ meta, nav: meta.nav }] : []))
    .sort((a, b) => a.nav.order - b.nav.order),
);

export const guideLinks = once((): ContentLink[] =>
  navGuides().map(({ meta }) => ({ label: meta.title, href: guidePath(meta) })),
);

export const guideFooterLinks = once((): ContentLink[] =>
  navGuides().map(({ meta, nav }) => ({
    label: nav.label,
    href: guidePath(meta),
  })),
);

export const guideMenu = once((): (ContentGroup | ContentLink)[] =>
  navGuides().reduce<(ContentGroup | ContentLink)[]>((menu, { meta, nav }) => {
    const link = { label: nav.label, href: guidePath(meta) };
    if (nav.group === null) {
      return [...menu, link];
    }
    const existing = menu.find(
      (item): item is ContentGroup =>
        "links" in item && item.label === nav.group,
    );
    if (existing) {
      existing.links.push(link);
      return menu;
    }
    return [...menu, { label: nav.group, links: [link] }];
  }, []),
);

export const compareLinks = once((): ContentLink[] =>
  metas(COMPARE_MODULES)
    .map((meta) => ({
      label: `bb vs ${meta.competitor.name}`,
      href: `/compare/${meta.slug}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label)),
);

const landingLinks = once((): ContentLink[] =>
  metas(LANDING_MODULES)
    .map((meta) => ({ label: meta.label, href: `/${meta.slug}` }))
    .sort((a, b) => a.label.localeCompare(b.label)),
);

const canonicalPaths = once(
  (): Record<string, string> =>
    Object.fromEntries(
      metas(GUIDE_MODULES).flatMap((meta) =>
        meta.canonical ? [[guidePath(meta), meta.canonical]] : [],
      ),
    ),
);

export function canonicalPath(path: string): string {
  return canonicalPaths()[path] ?? path;
}

export const contentPaths = once((): string[] => [
  ...metas(GUIDE_MODULES)
    .filter((meta) => meta.canonical === null)
    .map(guidePath),
  ...compareLinks().map((link) => link.href),
  ...landingLinks().map((link) => link.href),
]);
