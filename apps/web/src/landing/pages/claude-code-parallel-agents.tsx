import type { LandingMeta, LandingPage } from "../landing-template";
import {
  FAQ_AGENTS,
  FAQ_CODEX_TOGETHER,
  FAQ_CUSTOMIZE,
  FAQ_PARALLEL,
  faqScript,
  faqTalk,
} from "../../compare/compare-content";
import {
  ANYWHERE_COPY,
  LIMITS_COPY,
  SPAWN_COPY,
  anywhereSection,
  limitsSection,
  spawnSection,
} from "../../compare/compare-sections";
import { FleetVisual } from "../../compare/compare-visuals";
import {
  CODEX_SECTION,
  FAQ_LIMIT_RESET,
  FAQ_STAY_ON,
  FAQ_WHO_NEEDS_YOU,
  PARALLEL_SECTION,
  START_WITH_PLANS_FAQ,
} from "../landing-shared";

export const meta: LandingMeta = {
  slug: "claude-code-parallel-agents",
  label: "Parallel coding agents",
};

export const page: LandingPage = {
  ...meta,
  title: "Run Claude Code Agents in Parallel — bb",
  description:
    "Run Claude Code, Codex, and other agents in parallel, each in its own Git worktree, and always know which one needs you. Free and open source.",
  headline: "Build your own software factory of coding agents",
  sub: "Run Claude Code, Codex, and more in parallel, see which one needs you, and script every step with plugins and the bb CLI.",
  closer: "Start building your own software factory",
  heroVisual: <FleetVisual />,
  sections: [
    PARALLEL_SECTION,
    spawnSection(SPAWN_COPY),
    anywhereSection(ANYWHERE_COPY),
    limitsSection(LIMITS_COPY),
    CODEX_SECTION,
  ],
  faq: [
    {
      title: "Running a software factory",
      items: [
        FAQ_WHO_NEEDS_YOU,
        FAQ_PARALLEL,
        faqTalk(null),
        FAQ_CODEX_TOGETHER,
        FAQ_CUSTOMIZE,
        faqScript(null),
        FAQ_LIMIT_RESET,
        FAQ_STAY_ON,
        FAQ_AGENTS,
      ],
    },
    START_WITH_PLANS_FAQ,
  ],
};
