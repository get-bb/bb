export interface DocMeta {
  slug: string;
  path: string;
  title: string;
  description: string;
  section: string;
  order: number;
  updated: string;
  relatedGuides: string[];
  relatedDocs: string[];
  redirectFrom: string[];
  headings: Array<{ id: string; text: string; depth: 2 | 3 }>;
}
