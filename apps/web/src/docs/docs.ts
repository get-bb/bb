import { DOCS, DOC_REDIRECTS } from "virtual:docs-meta";

export { DOCS, DOC_REDIRECTS };
export { DOC_SECTIONS } from "./sections";

export async function getDoc(slug: string) {
  const meta = DOCS.find((doc) => doc.slug === slug);
  if (!meta) return undefined;
  const { DOC_BODIES } = await import("virtual:docs-bodies");
  const body = await DOC_BODIES[slug]();
  return { meta, body: body.default };
}
