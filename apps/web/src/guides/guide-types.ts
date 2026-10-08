import type { IconSvgElement } from "@hugeicons/react";
import type { ReactNode } from "react";

export interface GuideShot {
  src: string;
  alt: string;
}

export interface GuideStepOption {
  title: string;
  body: ReactNode;
  shot: GuideShot;
}

export interface GuideStep {
  id: string;
  title: string;
  lead: ReactNode;
  body: ReactNode;
  shot: GuideShot;
  options: GuideStepOption[];
  doneWhen: ReactNode;
}

export interface GuideNeed {
  title: string;
  icon: IconSvgElement;
  body: ReactNode;
}

export interface GuideFaq {
  question: string;
  answer: ReactNode;
}

export interface GuidePickerOption {
  id: string;
  label: string;
}

export interface GuidePicker {
  label: string;
  placeholder: string;
  selected: string | null;
  options: GuidePickerOption[];
}

export interface Guide {
  slug: string;
  title: string;
  description: string;
  concept: ReactNode;
  picker: GuidePicker | null;
  handoffNote: string;
  agentPrompt: string;
  needs: [GuideNeed, ...GuideNeed[]];
  steps: GuideStep[];
  troubleshooting: [GuideFaq, ...GuideFaq[]];
  faq: GuideFaq[];
  closer: { title: string; body: string };
}
