import type { LandingMeta, LandingPage } from "../landing-template";
import {
  FAQ_AGENTS,
  FAQ_PARALLEL,
  FAQ_SUBSCRIPTIONS,
} from "../../compare/compare-content";
import {
  ANYWHERE_COPY,
  LIMITS_COPY,
  SPAWN_COPY,
  anywhereSection,
  limitsSection,
  spawnSection,
} from "../../compare/compare-sections";
import { AgentSplit, ReviewVisual } from "../../compare/compare-visuals";
import {
  CODEX_SECTION,
  FAQ_LIMIT_RESET,
  PARALLEL_SECTION,
  PHONE_FAQ,
  START_FAQ,
} from "../landing-shared";

export const meta: LandingMeta = {
  slug: "claude-code-and-codex",
  label: "Claude Code with Codex",
};

export const page: LandingPage = {
  ...meta,
  title: "Use Claude Code and Codex Together — bb",
  description:
    "Have Codex review Claude Code’s work with no copy-paste between them. Both run in one free, open-source app, on the subscriptions you already have.",
  headline: "Have Codex review Claude Code’s work",
  sub: "No copy-paste between them. Both run in one app on the subscriptions you already have. Free and open source.",
  closer: "Let your agents check each other’s work",
  heroVisual: <AgentSplit />,
  sections: [
    { ...CODEX_SECTION, wide: false, visual: <ReviewVisual /> },
    spawnSection(SPAWN_COPY),
    PARALLEL_SECTION,
    limitsSection(LIMITS_COPY),
    anywhereSection(ANYWHERE_COPY),
  ],
  faq: [
    {
      title: "Claude Code and Codex",
      items: [FAQ_SUBSCRIPTIONS, FAQ_PARALLEL, FAQ_LIMIT_RESET, FAQ_AGENTS],
    },
    START_FAQ,
    PHONE_FAQ,
  ],
};
