import type { ReactElement, ReactNode } from "react";

import type { BrandLogo } from "./compare-visuals";

export type Mark = "yes" | "partial" | "no";

export type CompareCell = {
  mark: Mark | null;
  value: string;
  text: string;
  href: string | null;
  pro: boolean;
};

export type CompareRow = {
  feature: string;
  bb: CompareCell;
  competitor: CompareCell;
};

export type CompareGroup = {
  title: string;
  rows: CompareRow[];
};

export type CompareHighlight = {
  title: string;
  body: ReactNode;
  visual: ReactNode;
  wide: boolean;
};

export type CompareFaq = {
  question: string;
  answer: ReactNode;
};

export type CompareFaqGroup = {
  title: string;
  items: CompareFaq[];
};

export type CompareMeta = {
  slug: string;
  competitor: { name: string; logo: BrandLogo };
};

export type Comparison = CompareMeta & {
  title: string;
  description: string;
  headline: string;
  sub: string;
  heroVisual: ReactElement;
  tailored: CompareHighlight;
  sections: CompareHighlight[];
  tableNote: string | null;
  table: CompareGroup[];
  faqTitle: string;
  faq: CompareFaqGroup[];
  closer: { title: string; body: string };
};
