import type { ReactNode } from "react";

export interface GuideShot {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export type GuideNavGroup = "Automate" | "Remote & mobile";

export interface GuideNav {
  group: GuideNavGroup | null;
  label: string;
  order: number;
}

export interface GuideMeta {
  slug: string;
  title: string;
  nav: GuideNav | null;
  canonical: string | null;
}

export interface GuideStepOption {
  title: string;
  body: ReactNode;
  shot: GuideShot;
}

export interface GuideStep {
  id: string;
  title: string;
  lead: ReactNode | null;
  body: ReactNode;
  shot: GuideShot;
  options: GuideStepOption[];
}

export interface GuideFaq {
  question: string;
  answer: ReactNode;
}

export interface Guide extends GuideMeta {
  description: string;
  heroTop: ReactNode | null;
  concept: ReactNode;
  agentPrompt: string;
  requirement: string | null;
  steps: GuideStep[];
  troubleshooting: [GuideFaq, ...GuideFaq[]];
  faq: GuideFaq[];
  closer: { title: string; body: string };
}
