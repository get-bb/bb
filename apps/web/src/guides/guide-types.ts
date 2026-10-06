import type { IconSvgElement } from "@hugeicons/react";
import type { ReactNode } from "react";

export type Who = "you" | "agent";

export interface GuideStep {
  id: string;
  title: string;
  who: Who;
  lead: ReactNode;
  body: ReactNode;
  doneWhen: ReactNode;
}

export interface GuideNeed {
  title: string;
  icon: IconSvgElement;
  body: ReactNode;
}

export interface GuideSection {
  id: string;
  title: string;
  body: ReactNode;
}

export interface GuideFaq {
  question: string;
  answer: ReactNode;
}

export interface Guide {
  slug: string;
  title: string;
  description: string;
  blurb: string;
  meta: string;
  concept: ReactNode;
  overviewNote: ReactNode;
  handoffNote: string;
  agentPrompt: string;
  needs: GuideNeed[];
  steps: GuideStep[];
  sections: GuideSection[];
  prompts: string[];
  faq: GuideFaq[];
  related: string[];
  closer: { title: string; body: string };
}
