import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import type {
  CascadeDeps,
  ProcessResult,
  RenodeDriver,
  RenodeReplayRequest,
  TierVerdict,
} from "./types.js";
import { CascadeError } from "./types.js";
import { validateVerdict } from "./escalation.js";

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const TIMESTAMP = /^\s*(?:\d{2}:){2}\d{2}(?:\.\d+)?\s+/u;

function boundedAppend(current: string, chunk: Buffer): string {
  const combined = Buffer.concat([Buffer.from(current), chunk]);
  return combined
    .subarray(Math.max(0, combined.length - MAX_OUTPUT_BYTES))
    .toString("utf8");
}

function runProcess(
  executable: string,
  argv: readonly string[],
  cwd: string,
  signal: AbortSignal,
): Promise<ProcessResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, [...argv], {
      cwd,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = boundedAppend(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = boundedAppend(stderr, chunk);
    });
    const terminate = () => {
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      } else child.kill("SIGKILL");
    };
    const onAbort = () => {
      terminate();
      if (!settled) {
        settled = true;
        reject(signal.reason);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => {
      signal.removeEventListener("abort", onAbort);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    // Resolve on process exit rather than stdio close: a detached grandchild
    // can inherit pipes and otherwise defeat the caller's deadline.
    child.once("exit", (code) => {
      signal.removeEventListener("abort", onAbort);
      child.stdout.destroy();
      child.stderr.destroy();
      if (!settled) {
        settled = true;
        resolveResult({ exitCode: code ?? -1, stdout, stderr });
      }
    });
  });
}

export function createRenodeDriver(executable = "renode"): RenodeDriver {
  return {
    executable,
    async probe(signal) {
      try {
        return (
          (await runProcess(executable, ["-v"], process.cwd(), signal))
            .exitCode === 0
        );
      } catch {
        if (signal.aborted) throw signal.reason;
        return false;
      }
    },
    run(argv, cwd, signal) {
      return runProcess(executable, argv, cwd, signal);
    },
  };
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path === "" ||
    (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
  );
}

async function checkedInPath(
  deps: CascadeDeps,
  path: string,
  extension: string,
  signal: AbortSignal,
): Promise<string> {
  const [root, candidate] = await Promise.all([
    realpath(deps.scenariosRoot),
    realpath(path),
  ]);
  if (!inside(root, candidate) || extname(candidate) !== extension) {
    throw new CascadeError(
      "D2_SCENARIO_NOT_ALLOWED",
      `D2 requires a checked-in ${extension} file below the configured replay root.`,
    );
  }
  if (!(await deps.isTrackedFile(candidate, signal))) {
    throw new CascadeError(
      "D2_SCENARIO_NOT_TRACKED",
      "D2 refuses untracked replay inputs.",
    );
  }
  return candidate;
}

function normalizeLog(log: string, scenariosRoot: string): string {
  return log
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) =>
      line.replace(TIMESTAMP, "").replaceAll(scenariosRoot, "<SCENARIOS>"),
    )
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

function outputLogPath(root: string, artifactPath: string): string {
  if (
    !artifactPath.startsWith(".fs-bench/") ||
    artifactPath.includes("\\") ||
    artifactPath
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..") ||
    extname(artifactPath) !== ".log"
  ) {
    throw new CascadeError(
      "D2_INVALID_OUTPUT_PATH",
      "D2 output must be a safe .fs-bench/*.log artifact path.",
    );
  }
  return join(root, ...artifactPath.split("/"));
}

export async function runD2(
  deps: CascadeDeps,
  request: RenodeReplayRequest,
  signal: AbortSignal,
): Promise<TierVerdict> {
  if (request.kind === "model_platform") {
    throw new CascadeError(
      "D2_OUT_OF_SCOPE",
      "D2 replays checked-in boot-chain and golden-regression scenarios; it does not author platform models.",
    );
  }
  signal.throwIfAborted();
  if (!(await deps.renode.probe(signal))) {
    throw new CascadeError(
      "RENODE_NOT_CONFIGURED",
      "Install or configure Renode to run deterministic D2 replays.",
      "debug-bench.renode",
    );
  }
  const [scenarioPath, platformPath, goldenLogPath] = await Promise.all([
    checkedInPath(deps, request.scenarioPath, ".resc", signal),
    checkedInPath(deps, request.platformPath, ".repl", signal),
    checkedInPath(deps, request.goldenLogPath, ".log", signal),
  ]);
  const artifactOutputPath = outputLogPath(
    deps.artifactsRoot,
    request.outputArtifactPath,
  );
  const scenario = await deps.readText(scenarioPath, signal);
  if (!scenario.includes(platformPath.split(sep).at(-1) ?? platformPath)) {
    throw new CascadeError(
      "D2_PLATFORM_NOT_REFERENCED",
      "The checked-in Renode scenario does not reference the declared platform description.",
    );
  }
  const argv = [
    "-p",
    "--console",
    "--disable-gui",
    scenarioPath,
    "-e",
    "quit",
  ] as const;
  const cwd = dirname(scenarioPath);
  const first = await deps.renode.run(argv, cwd, signal);
  const second = await deps.renode.run(argv, cwd, signal);
  if (first.exitCode !== 0 || second.exitCode !== 0) {
    throw new CascadeError(
      "RENODE_REPLAY_FAILED",
      (first.stderr || second.stderr || "Renode replay failed.").slice(0, 2000),
    );
  }
  const root = await realpath(deps.scenariosRoot);
  const firstLog = normalizeLog(first.stdout, root);
  const secondLog = normalizeLog(second.stdout, root);
  if (firstLog !== secondLog) {
    throw new CascadeError(
      "D2_NONDETERMINISTIC_OUTPUT",
      "Two identical Renode invocations produced different normalized logs.",
    );
  }
  const golden = normalizeLog(await deps.readText(goldenLogPath, signal), root);
  await deps.writeText(artifactOutputPath, `${firstLog}\n`, signal);
  const verdict: TierVerdict = {
    tier: "d2",
    hypothesisId: request.hypothesis.id,
    outcome: firstLog === golden ? "confirmed" : "refuted",
    forcedEscalation: false,
    evidence: [{ kind: "renode-log", path: request.outputArtifactPath }],
    producedBy: {
      command: [deps.renode.executable, ...argv],
      inputs: {
        scenarioPath,
        platformPath,
        goldenLogPath,
        replayCount: "2",
      },
    },
  };
  return validateVerdict(verdict, request.hypothesis);
}

export const runD2Renode = runD2;
