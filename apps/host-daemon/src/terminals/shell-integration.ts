import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HostDaemonLogger } from "../logger.js";
import { runtimeErrorLogFields } from "../error-utils.js";

export type TerminalShellIntegrationKind = "bash" | "zsh";

export interface TerminalShellIntegration {
  args: string[];
  cleanup: () => Promise<void>;
  env: NodeJS.ProcessEnv;
  kind: TerminalShellIntegrationKind;
}

interface CreateTerminalShellIntegrationArgs {
  logger: HostDaemonLogger;
  shell: string;
  userZdotdir: string | undefined;
}

const ZSH_STARTUP_FILES = [
  ".zshenv",
  ".zprofile",
  ".zshrc",
  ".zlogin",
  ".zlogout",
] as const;

const SHELL_INTEGRATION_ZSH = `if [ -n "\${BB_SHELL_INTEGRATION_ACTIVE-}" ]; then
  return
fi
BB_SHELL_INTEGRATION_ACTIVE=1

autoload -Uz add-zsh-hook

__bb_encode_command() {
  print -rn -- "$1" | base64 | tr -d '\\n'
}

__bb_preexec() {
  __bb_command_running=1
  if (( $+commands[base64] )); then
    printf '\\033]133;P;cmdline_b64=%s\\007' "$(__bb_encode_command "$1")"
  fi
  printf '\\033]133;C\\007'
}

__bb_precmd() {
  local exit_code=$?
  if [ -n "\${__bb_command_running-}" ]; then
    printf '\\033]133;D;%s\\007' "$exit_code"
    unset __bb_command_running
  fi
  printf '\\033]7;file://%s%s\\007' "\${HOST-}" "$PWD"
  printf '\\033]133;A\\007'
}

add-zsh-hook preexec __bb_preexec
add-zsh-hook precmd __bb_precmd
`;

const SHELL_INTEGRATION_BASH = `if [ -n "\${BB_SHELL_INTEGRATION_ACTIVE-}" ]; then
  return
fi
BB_SHELL_INTEGRATION_ACTIVE=1

__bb_preexec_done=

__bb_current_command() {
  local entry
  entry=$(builtin history 1)
  if [[ $entry =~ ^[[:space:]]*[0-9]+[[:space:]]+(.*)$ ]]; then
    printf '%s' "\${BASH_REMATCH[1]}"
    return
  fi
  printf '%s' "$BASH_COMMAND"
}

__bb_preexec() {
  if [ -n "\${COMP_LINE-}" ]; then
    return
  fi
  if [ -n "$__bb_preexec_done" ]; then
    return
  fi
  if [ "$BASH_COMMAND" = "__bb_precmd" ]; then
    return
  fi
  __bb_preexec_done=1
  __bb_command_running=1
  if command -v base64 >/dev/null 2>&1; then
    printf '\\033]133;P;cmdline_b64=%s\\007' "$(__bb_current_command | base64 | tr -d '\\n')"
  fi
  printf '\\033]133;C\\007'
}

__bb_precmd() {
  local exit_code=$?
  if [ -n "\${__bb_command_running-}" ]; then
    printf '\\033]133;D;%s\\007' "$exit_code"
    unset __bb_command_running
  fi
  printf '\\033]7;file://%s%s\\007' "\${HOSTNAME-}" "$PWD"
  printf '\\033]133;A\\007'
  __bb_preexec_done=
}

trap '__bb_preexec' DEBUG
PROMPT_COMMAND="__bb_precmd\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
`;

function zshStartupShim(fileName: string, isRunCommands: boolean): string {
  const integrationSource = isRunCommands
    ? `if [ -f "$BB_SHELL_INTEGRATION_DIR/integration.zsh" ]; then
  source "$BB_SHELL_INTEGRATION_DIR/integration.zsh"
fi
`
    : "";
  const restoreZdotdir = isRunCommands
    ? `if [ -n "\${BB_SHELL_INTEGRATION_USER_ZDOTDIR-}" ]; then
  ZDOTDIR=$BB_SHELL_INTEGRATION_USER_ZDOTDIR
else
  unset ZDOTDIR
fi
`
    : "";
  return `__bb_user_zdotdir=\${BB_SHELL_INTEGRATION_USER_ZDOTDIR:-$HOME}
if [ -f "$__bb_user_zdotdir/${fileName}" ]; then
  ZDOTDIR=$__bb_user_zdotdir
  source "$__bb_user_zdotdir/${fileName}"
  if [ "$ZDOTDIR" != "$__bb_user_zdotdir" ]; then
    BB_SHELL_INTEGRATION_USER_ZDOTDIR=$ZDOTDIR
  fi
fi
ZDOTDIR=$BB_SHELL_INTEGRATION_DIR
unset __bb_user_zdotdir
${integrationSource}${restoreZdotdir}`;
}

export function terminalShellIntegrationKind(
  shell: string,
): TerminalShellIntegrationKind | null {
  switch (path.basename(shell)) {
    case "zsh":
      return "zsh";
    case "bash":
      return "bash";
    default:
      return null;
  }
}

async function createZshShellIntegration(
  directory: string,
  userZdotdir: string | undefined,
): Promise<TerminalShellIntegration> {
  await writeFile(
    path.join(directory, "integration.zsh"),
    SHELL_INTEGRATION_ZSH,
    "utf8",
  );
  for (const fileName of ZSH_STARTUP_FILES) {
    await writeFile(
      path.join(directory, fileName),
      zshStartupShim(fileName, fileName === ".zshrc"),
      "utf8",
    );
  }
  return {
    args: [],
    cleanup: () => rm(directory, { force: true, recursive: true }),
    env: {
      BB_SHELL_INTEGRATION: "1",
      BB_SHELL_INTEGRATION_DIR: directory,
      ...(userZdotdir === undefined
        ? {}
        : { BB_SHELL_INTEGRATION_USER_ZDOTDIR: userZdotdir }),
      ZDOTDIR: directory,
    },
    kind: "zsh",
  };
}

async function createBashShellIntegration(
  directory: string,
): Promise<TerminalShellIntegration> {
  const rcPath = path.join(directory, "bb-bashrc");
  await writeFile(
    rcPath,
    `if [ -f "$HOME/.bashrc" ]; then
  source "$HOME/.bashrc"
fi
${SHELL_INTEGRATION_BASH}`,
    "utf8",
  );
  return {
    args: ["--rcfile", rcPath],
    cleanup: () => rm(directory, { force: true, recursive: true }),
    env: {
      BB_SHELL_INTEGRATION: "1",
      BB_SHELL_INTEGRATION_DIR: directory,
    },
    kind: "bash",
  };
}

export async function createTerminalShellIntegration(
  args: CreateTerminalShellIntegrationArgs,
): Promise<TerminalShellIntegration | null> {
  const kind = terminalShellIntegrationKind(args.shell);
  if (kind === null) {
    return null;
  }
  let directory: string | null = null;
  try {
    directory = await mkdtemp(path.join(os.tmpdir(), "bb-shell-integration-"));
    if (kind === "zsh") {
      return await createZshShellIntegration(directory, args.userZdotdir);
    }
    return await createBashShellIntegration(directory);
  } catch (error) {
    args.logger.warn(
      {
        component: "terminal-manager",
        shell: args.shell,
        ...runtimeErrorLogFields(error),
      },
      "Failed to prepare terminal shell integration",
    );
    if (directory !== null) {
      await rm(directory, { force: true, recursive: true }).catch(() => {});
    }
    return null;
  }
}
