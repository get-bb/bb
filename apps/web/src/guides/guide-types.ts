import type { IconSvgElement } from "@hugeicons/react";
import type { ReactNode } from "react";

export interface GuideStep {
  id: string;
  title: string;
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
  concept: ReactNode;
  handoffNote: string;
  agentPrompt: string;
  needs: GuideNeed[];
  steps: GuideStep[];
  sections: GuideSection[];
  faq: GuideFaq[];
  closer: { title: string; body: string };
}
