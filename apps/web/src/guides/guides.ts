import type { Guide } from "./guide-types";
import { AGENT_BROWSER } from "./pages/agent-browser";
import { AGENT_BROWSER_FOR_WORK } from "./pages/agent-browser-for-work";
import { CLAUDE_CODE_AND_CODEX } from "./pages/claude-code-and-codex-together";
import { ORCHESTRATE_CODING_AGENTS } from "./pages/orchestrate-coding-agents";
import { REMOTE_DEV_SERVERS } from "./pages/remote-dev-servers";
import { RUN_AN_AGENT_ON_A_SCHEDULE } from "./pages/run-an-agent-on-a-schedule";
import { SWITCH_TO_BB, switchToBb } from "./pages/switch-to-bb";
import { WORK_FROM_ANYWHERE } from "./pages/work-from-anywhere";

export const GUIDES: Guide[] = [
  REMOTE_DEV_SERVERS,
  WORK_FROM_ANYWHERE,
  CLAUDE_CODE_AND_CODEX,
  ORCHESTRATE_CODING_AGENTS,
  SWITCH_TO_BB,
  RUN_AN_AGENT_ON_A_SCHEDULE,
  AGENT_BROWSER,
  AGENT_BROWSER_FOR_WORK,
];

export function getGuide(
  slug: string,
  variant: string | null,
): Guide | undefined {
  if (slug === SWITCH_TO_BB.slug) {
    return switchToBb(variant);
  }
  return GUIDES.find((guide) => guide.slug === slug);
}
