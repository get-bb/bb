import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

export const BB_CLI_REEXEC_ENV = "BB_CLI_REEXEC";

interface MaybeReexecViaBbCliArgs {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  currentExecutablePath?: string;
  platform?: NodeJS.Platform;
  reexec?: (args: {
    target: string;
    argv: string[];
    env: NodeJS.ProcessEnv;
  }) => void;
}

export function resolveBbCliReexecSpawnPlan(
  cliPath: string,
  platform: NodeJS.Platform,
): { argsPrefix: string[]; command: string; shell: boolean } {
  if (platform !== "win32") {
    return { argsPrefix: [], command: cliPath, shell: false };
  }
  if (!cliPath.toLowerCase().endsWith(".cmd")) {
    return { argsPrefix: [], command: cliPath, shell: false };
  }
  const target = cliPath.slice(0, -".cmd".length);
  if (!existsSync(target)) {
    return { argsPrefix: [], command: cliPath, shell: true };
  }
  return { argsPrefix: [target], command: process.execPath, shell: false };
}

function tryRealpath(path: string): string | null {
  try {
    return realpathSync(resolve(path));
  } catch {
    return null;
  }
}

export function maybeReexecViaBbCli(
  options: MaybeReexecViaBbCliArgs = {},
): void {
  const env = options.env ?? process.env;
  if (env[BB_CLI_REEXEC_ENV] === "1") {
    return;
  }

  const targetRaw = env.BB_CLI?.trim();
  if (!targetRaw) {
    return;
  }

  const currentRaw = options.currentExecutablePath ?? process.argv[1];
  if (!currentRaw) {
    return;
  }

  const target = tryRealpath(targetRaw);
  const current = tryRealpath(currentRaw);
  if (target === null || current === null || target === current) {
    return;
  }

  const argv = options.argv ?? process.argv.slice(2);
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    [BB_CLI_REEXEC_ENV]: "1",
  };

  if (options.reexec) {
    options.reexec({ target, argv, env: childEnv });
    return;
  }

  const platform = options.platform ?? process.platform;
  const plan = resolveBbCliReexecSpawnPlan(target, platform);
  const result = spawnSync(plan.command, [...plan.argsPrefix, ...argv], {
    env: childEnv,
    stdio: "inherit",
    ...(plan.shell ? { shell: true, windowsHide: true } : {}),
  });
  if (result.error) {
    process.stderr.write(
      `bb: failed to re-exec BB_CLI=${target}: ${result.error.message}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.exit(result.status === null ? 1 : result.status);
}
