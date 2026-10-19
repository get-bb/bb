import { PLUGIN_INTERACTION_MAX_TITLE_LENGTH } from "@get-bb/plugin-sdk/provider-bridge";
import {
  truncateCodePoints,
  type CodexMcpElicitation,
} from "./mcp-elicitation.js";

export function codexMcpElicitationTitle(
  elicitation: CodexMcpElicitation,
): string {
  const title =
    elicitation.kind === "computer_use"
      ? `Allow Codex to use ${elicitation.app.name}?`
      : elicitation.message;
  return truncateCodePoints(title.trim(), PLUGIN_INTERACTION_MAX_TITLE_LENGTH);
}
