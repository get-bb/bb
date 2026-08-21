import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { resolveContainedPath } from "@bb/process-utils";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  bold,
  cyan,
  dim,
  green,
  yellow,
  log,
  endStep,
} from "../lib/script-helpers.js";
import {
  resolveCurrentDevInstanceConfig,
  resolveRuntimeDataDir,
  resolveRuntimeMode,
  type BbRuntimeMode,
} from "@bb/config/runtime";

const commandDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(commandDir, "..", "..");
const repoRoot = resolve(packageRoot, "..", "..");

function resolveResetDataDir(mode: BbRuntimeMode): string {
  if (mode === "dev") {
    return resolveCurrentDevInstanceConfig(repoRoot).dataDir;
  }

  return resolveRuntimeDataDir({
    env: process.env,
    homeDir: homedir(),
    mode,
  });
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((pathValue) => resolve(pathValue)))];
}

export function resolveResetTargets(args: Set<string>): string[] {
  const mode = resolveRuntimeMode();

  if (args.has("--all")) {
    return uniquePaths([
      resolveRuntimeDataDir({
        env: process.env,
        homeDir: homedir(),
        mode: "prod",
      }),
      resolveCurrentDevInstanceConfig(repoRoot).dataDir,
    ]);
  }

  return [resolveResetDataDir(mode)];
}

export function ensureSafeTargets(targets: string[]): void {
  const home = resolve(homedir());
  for (const target of targets) {
    if (!isAbsolute(target)) {
      throw new Error(`Refusing to remove non-absolute path: ${target}`);
    }
    const resolvedTarget = resolve(target);
    const containedTarget = resolveContainedPath({
      rootPath: home,
      candidatePath: resolvedTarget,
    });
    if (!containedTarget) {
      throw new Error(`Refusing to remove unsafe path: ${target}`);
    }
  }
}

export function renderHelpText(): string {
  return `
  ${bold("bb reset")}

  ${dim("Usage")}
    pnpm reset -- [--all] [--yes]

  ${dim("Options")}
    --all   Remove prod and this checkout's dev data directories
    --yes   Skip the interactive confirmation prompt

  ${dim("Notes")}
    Removes bb-managed state directories (${dim("~/.bb")}, ${dim("~/.bb-dev/<checkout-instance>")}).
    Does not touch external provider config managed by other tools.
    Production resets respect BB_DATA_DIR. Development resets always target this checkout's dev data directory.
\n`;
}

async function confirmReset(targets: string[]): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Interactive confirmation requires a TTY. Re-run with --yes to confirm.",
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    process.stdout.write("\n");
    log(yellow("!"), "This will permanently delete bb-managed local data at:");
    for (const target of targets) {
      log(" ", dim(target));
    }
    process.stdout.write("\n");
    log(
      " ",
      dim("Provider auth/config managed outside bb will be left untouched."),
    );
    process.stdout.write("\n");
    const answer = await rl.question(
      `  ${dim("?")}  Type ${bold('"reset"')} to continue: `,
    );
    return answer.trim() === "reset";
  } finally {
    rl.close();
  }
}

async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = new Set(argv);

  if (args.has("--help") || args.has("-h")) {
    process.stdout.write(renderHelpText());
    return;
  }

  process.stdout.write(`\n  ${bold("bb reset")}\n`);

  const targets = resolveResetTargets(args);
  ensureSafeTargets(targets);

  const proceed = args.has("--yes") ? true : await confirmReset(targets);
  if (!proceed) {
    process.stdout.write("\n");
    log(dim("●"), "Reset cancelled");
    process.stdout.write("\n");
    return;
  }

  process.stdout.write("\n");

  let removedCount = 0;
  for (const target of targets) {
    if (!existsSync(target)) {
      endStep(dim("–"), `${dim("skip")}  ${target} ${dim("(not found)")}`);
      continue;
    }
    rmSync(target, {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 100,
    });
    endStep(green("✓"), `${cyan(target)}`);
    removedCount += 1;
  }

  process.stdout.write("\n");

  if (removedCount === 0) {
    log(dim("●"), "No bb-managed data directories were present");
  } else {
    log(green("●"), bold("Reset complete"));
  }

  process.stdout.write("\n");
}

if (
  process.argv[1] != null &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().catch((error) => {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
