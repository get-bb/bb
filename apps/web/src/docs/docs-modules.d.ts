declare module "virtual:docs-meta" {
  export const DOCS: import("./types").DocMeta[];
  export const DOC_REDIRECTS: Record<string, string>;
}

declare module "virtual:docs-bodies" {
  export const DOC_BODIES: Record<string, () => Promise<{ default: string }>>;
}
