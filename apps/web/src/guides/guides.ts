import type { Guide } from "./guide-types";
import { CLAUDE_CODE_AND_CODEX } from "./pages/claude-code-and-codex-together";
import { REMOTE_DEV_SERVERS } from "./pages/remote-dev-servers";
import { WORK_FROM_ANYWHERE } from "./pages/work-from-anywhere";

export const GUIDES: Guide[] = [
  REMOTE_DEV_SERVERS,
  WORK_FROM_ANYWHERE,
  CLAUDE_CODE_AND_CODEX,
];

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((guide) => guide.slug === slug);
}
