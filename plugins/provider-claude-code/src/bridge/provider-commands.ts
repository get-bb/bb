import { z } from "zod";
import { probeClaudeInitialization } from "./initialization-probe.js";
import { isClaudeSkillPluginName } from "./skill-plugins.js";

export const PROVIDER_COMMANDS_STATE_KIND = "bb/provider-commands";

const MAX_COMMANDS = 500;
const MAX_DESCRIPTION_LENGTH = 300;
const MAX_INPUT_HINT_LENGTH = 200;
const MAX_PAYLOAD_BYTES = 60 * 1024;

const HIDDEN_COMMANDS: ReadonlySet<string> = new Set([
  "add-dir",
  "advisor",
  "agents",
  "auto-mode-setup",
  "autocompact",
  "clear",
  "color",
  "compact",
  "config",
  "doctor",
  "effort",
  "exit",
  "export",
  "fast",
  "focus",
  "heapdump",
  "hooks",
  "ide",
  "import",
  "install-github-app",
  "keybindings",
  "login",
  "logout",
  "mcp",
  "model",
  "output-style",
  "permissions",
  "plugin",
  "privacy-settings",
  "quit",
  "reload-plugins",
  "rename",
  "resume",
  "sandbox",
  "statusline",
  "terminal-setup",
  "theme",
  "upgrade",
  "vim",
  "workflow-launch-exec",
]);

const reportedCommandSchema = z.object({
  name: z.string(),
  description: z.string().catch(""),
  argumentHint: z.string().catch(""),
});

function readReportedCommands(
  value: unknown,
): z.infer<typeof reportedCommandSchema>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const parsed = reportedCommandSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

export type ClaudeProviderCommand = {
  name: string;
  description: string;
  inputHint?: string;
};

export type ClaudeProviderCommandsState = {
  commands: ClaudeProviderCommand[];
};

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
  reported: unknown,
): ClaudeProviderCommandsState {
  const commands = readReportedCommands(reported);
  const state: ClaudeProviderCommandsState = { commands: [] };
  const seen = new Set<string>();
  let bytes = Buffer.byteLength(JSON.stringify(state));
  for (const command of commands) {
    const name = command.name.trim();
    if (
      name === "" ||
      name.startsWith("__") ||
      HIDDEN_COMMANDS.has(name) ||
      isInjectedSkill(name) ||
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

export async function listClaudeCodeBridgeCommands(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ClaudeProviderCommandsState> {
  const initialization = await probeClaudeInitialization({ env, cwd });
  return toProviderCommandsState(initialization.commands);
}

interface ClaudeCodeBridgeCommandListMemoOptions {
  list?: (cwd: string) => Promise<ClaudeProviderCommandsState>;
  now?: () => number;
  ttlMs: number;
}

export function createClaudeCodeBridgeCommandListMemo({
  list = listClaudeCodeBridgeCommands,
  now = Date.now,
  ttlMs,
}: ClaudeCodeBridgeCommandListMemoOptions): (
  cwd: string,
) => Promise<ClaudeProviderCommandsState> {
  const settled = new Map<
    string,
    { state: ClaudeProviderCommandsState; expiresAt: number }
  >();
  const pending = new Map<string, Promise<ClaudeProviderCommandsState>>();
  return (cwd) => {
    const cached = settled.get(cwd);
    if (cached !== undefined && cached.expiresAt > now()) {
      return Promise.resolve(cached.state);
    }
    settled.delete(cwd);
    const inFlight = pending.get(cwd);
    if (inFlight !== undefined) {
      return inFlight;
    }
    const probe = list(cwd)
      .then((state) => {
        settled.set(cwd, { state, expiresAt: now() + ttlMs });
        return state;
      })
      .finally(() => {
        if (pending.get(cwd) === probe) {
          pending.delete(cwd);
        }
      });
    pending.set(cwd, probe);
    return probe;
  };
}
