import type { LandingMeta, LandingPage } from "../landing-template";
import {
  FAQ_AGENTS,
  FAQ_CODEX_TOGETHER,
  FAQ_PARALLEL,
} from "../../compare/compare-content";
import {
  ANYWHERE_COPY,
  LIMITS_COPY,
  anywhereSection,
  limitsSection,
  textOnly,
} from "../../compare/compare-sections";
import { AnywhereVisual, FleetVisual } from "../../compare/compare-visuals";
import {
  CODEX_SECTION,
  FAQ_LIMIT_RESET,
  PARALLEL_SECTION,
  PHONE_FAQ,
  PHONE_SECTION,
  START_WITH_PLANS_FAQ,
} from "../landing-shared";

export const meta: LandingMeta = {
  slug: "claude-code-mobile",
  label: "Claude Code on your phone",
};

export const page: LandingPage = {
  ...meta,
  title: "Claude Code Mobile: See Which Agent Needs You — bb",
  description:
    "See which of your Claude Code, Codex, and other agents needs you, across all your machines, and reply from any phone browser. Free and open source.",
  headline: "Claude Code on your phone. See which agent needs you.",
  sub: "Claude Code, Codex, and your other agents in one list, marked running, waiting on you, or done. Reply from any phone browser. Free and open source.",
  closer: "Know which agent needs you",
  heroVisual: <AnywhereVisual />,
  sections: [
    textOnly(PHONE_SECTION),
    { ...anywhereSection(ANYWHERE_COPY), visual: <FleetVisual /> },
    PARALLEL_SECTION,
    limitsSection(LIMITS_COPY),
    CODEX_SECTION,
  ],
  faq: [
    PHONE_FAQ,
    {
      title: "Running several agents",
      items: [FAQ_PARALLEL, FAQ_CODEX_TOGETHER, FAQ_LIMIT_RESET, FAQ_AGENTS],
    },
    START_WITH_PLANS_FAQ,
  ],
};
