import type { Guide, GuideMeta } from "./guide-types";

const METAS = import.meta.glob<GuideMeta>("./pages/*.meta.ts", {
  eager: true,
  import: "meta",
});
const PAGES = import.meta.glob<Guide>("./pages/*.tsx", { import: "guide" });

const loading = new Map<string, Promise<Guide | null>>();
const loaded = new Map<string, Guide>();

function pageLoader(slug: string): (() => Promise<Guide>) | undefined {
  const entry = Object.entries(METAS).find(([, meta]) => meta.slug === slug);
  return entry ? PAGES[entry[0].replace(/\.meta\.ts$/u, ".tsx")] : undefined;
}

export function loadGuide(slug: string): Promise<Guide | null> {
  const existing = loading.get(slug);
  if (existing) {
    return existing;
  }
  const load = pageLoader(slug);
  if (!load) {
    return Promise.resolve(null);
  }
  const promise = load().then((guide) => {
    loaded.set(slug, guide);
    return guide;
  });
  loading.set(slug, promise);
  return promise;
}

export function loadedGuide(slug: string): Guide | undefined {
  return loaded.get(slug);
}
