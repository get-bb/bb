import type {
  SDKSystemMessage,
  SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import { isClaudeSkillPluginName } from "./skill-plugins.js";

export const PROVIDER_COMMANDS_STATE_KIND = "bb/provider-commands";

const MAX_COMMANDS = 500;
const MAX_DESCRIPTION_LENGTH = 300;
const MAX_INPUT_HINT_LENGTH = 200;
const MAX_PAYLOAD_BYTES = 60 * 1024;

export type ClaudeProviderCommand = {
  name: string;
  description: string;
  inputHint?: string;
};

export type ClaudeProviderCommandsState = {
  commands: ClaudeProviderCommand[];
};

export type ClaudeCommandExclusions = ReadonlySet<string>;

export function commandExclusionsFromInit(
  message: Pick<
    SDKSystemMessage,
    "skills" | "slash_commands" | "terminal_slash_commands"
  >,
): ClaudeCommandExclusions {
  const skills = new Set(message.skills);
  return new Set([
    ...message.slash_commands.filter((name) => !skills.has(name)),
    ...(message.terminal_slash_commands ?? []),
  ]);
}

function isInjectedSkill(name: string): boolean {
  const separator = name.indexOf(":");
  return separator > 0 && isClaudeSkillPluginName(name.slice(0, separator));
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

export function toProviderCommandsState(
  commands: readonly SlashCommand[],
  exclusions: ClaudeCommandExclusions,
): ClaudeProviderCommandsState {
  const state: ClaudeProviderCommandsState = { commands: [] };
  const seen = new Set<string>();
  let bytes = Buffer.byteLength(JSON.stringify(state));
  for (const command of commands) {
    const name = command.name.trim();
    if (
      name === "" ||
      name.startsWith("__") ||
      isInjectedSkill(name) ||
      exclusions.has(name) ||
      seen.has(name)
    ) {
      continue;
    }
    const inputHint = truncate(
      command.argumentHint.trim(),
      MAX_INPUT_HINT_LENGTH,
    );
    const entry: ClaudeProviderCommand = {
      name,
      description: truncate(command.description.trim(), MAX_DESCRIPTION_LENGTH),
      ...(inputHint === "" ? {} : { inputHint }),
    };
    const entryBytes = Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (
      state.commands.length >= MAX_COMMANDS ||
      bytes + entryBytes > MAX_PAYLOAD_BYTES
    ) {
      break;
    }
    seen.add(name);
    state.commands.push(entry);
    bytes += entryBytes;
  }
  return state;
}
