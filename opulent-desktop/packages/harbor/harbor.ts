/**
 * Harbor task-directory emitter.
 *
 * Byte-compatible with Repo2RLEnv's writer
 * (research/src/OpulentiaAI_Repo2RLEnv/src/repo2rlenv/emitter/harbor.py — [S20], [S21]),
 * so a task Opulent produces from a real desktop run drops into the same pipelines:
 * `repo2rlenv validate`, `harbor run`, and the SkyRL recipe's HarborTaskDataset ([S22]).
 *
 * Layout:
 *   <slug>/task.toml
 *   <slug>/instruction.md
 *   <slug>/solution/patch.diff
 *   <slug>/solution/solve.sh          (0755)
 *   <slug>/environment/Dockerfile     (sandbox-required tasks only)
 *   <slug>/tests/test.sh              (0755, sandbox-required tasks only)
 *   <slug>/<aux files>
 *
 * The verifier's reward contract is Harbor's: write /logs/verifier/reward.txt ([S21]).
 */

import { createHash } from "node:crypto";

export type RewardKind = "test_execution" | "diff_similarity";

export interface Reproducibility {
  readonly mode: "local_only" | "registry" | "inline_dockerfile";
  readonly imageRef: string;
  readonly imageTag: string;
  readonly imageVisibility: "public" | "private";
}

export interface HarborTask {
  /** Filesystem-safe slug; also the directory name. */
  readonly name: string;
  /** Emitted as `<org>/<name>` in task.toml, which Harbor's loader requires ([S21]). */
  readonly org: string;
  readonly description: string;
  readonly instruction: string;
  readonly oracleDiff: string;
  readonly difficulty?: string;
  readonly category?: string;
  readonly keywords?: readonly string[];
  /** Provenance, namespaced under metadata.repo2env as Repo2RLEnv does ([S21]). */
  readonly provenance?: Readonly<Record<string, string | number | boolean>>;
  readonly environmentDockerfile?: string;
  readonly testScript?: string;
  readonly auxFiles?: Readonly<Record<string, string>>;
  readonly agentTimeoutSec?: number;
  readonly verifierTimeoutSec?: number;
}

export interface EmittedFile {
  /** Path relative to the task directory's parent, i.e. starts with `<name>/`. */
  readonly path: string;
  readonly content: string;
  /** POSIX mode; 0o755 for the scripts Harbor executes. */
  readonly mode: number;
}

export class HarborEmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarborEmitError";
  }
}

/** sha256 over instruction + NUL + oracle diff — identical to Repo2RLEnv's `_content_hash` ([S21]). */
export function contentHash(task: Pick<HarborTask, "instruction" | "oracleDiff">): string {
  const h = createHash("sha256");
  h.update(Buffer.from(task.instruction, "utf8"));
  h.update(Buffer.from([0]));
  h.update(Buffer.from(task.oracleDiff, "utf8"));
  return `sha256:${h.digest("hex")}`;
}

const SPEC_VERSION = "0.2.0";
const FROM_LINE = /^\s*FROM\s+(\S+)/im;

function tomlString(value: string): string {
  // TOML basic string: escape backslash, quote, and control characters.
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

function tomlValue(value: string | number | boolean | readonly string[]): string {
  if (typeof value === "string") return tomlString(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `[${value.map(tomlString).join(", ")}]`;
}

function tomlTable(
  header: string,
  entries: ReadonlyArray<readonly [string, string | number | boolean | readonly string[]]>,
): string {
  const lines = [`[${header}]`];
  for (const [key, value] of entries) lines.push(`${key} = ${tomlValue(value)}`);
  return lines.join("\n");
}

/**
 * Derive the reproducibility subtable the way Repo2RLEnv seeds it: parse the first FROM
 * line of the Dockerfile and record mode=local_only until a registry push rewrites it ([S21]).
 */
export function seedReproducibility(dockerfile: string): Reproducibility {
  const match = FROM_LINE.exec(dockerfile);
  const image = match?.[1]?.trim() ?? "local/r2e-bootstrap:unknown";
  return {
    mode: "local_only",
    imageRef: image,
    imageTag: image,
    imageVisibility: "private",
  };
}

export function renderTaskToml(task: HarborTask): string {
  if (!task.name) throw new HarborEmitError("task.name is required");
  if (!task.org) throw new HarborEmitError("task.org is required");
  if (task.name.includes("/")) {
    throw new HarborEmitError(
      `task.name must be a filesystem-safe slug without "/", got "${task.name}"`,
    );
  }

  const rewardKinds: readonly RewardKind[] =
    task.testScript !== undefined
      ? ["test_execution", "diff_similarity"]
      : ["diff_similarity"];

  const blocks: string[] = [
    'version = "1.0"',
    "",
    tomlTable("task", [
      ["name", `${task.org}/${task.name}`],
      ["description", task.description],
    ]),
    "",
    tomlTable("metadata", [
      ["difficulty", task.difficulty ?? "medium"],
      ["category", task.category ?? "bugfix"],
      ["keywords", task.keywords ?? []],
    ]),
    "",
  ];

  const repo2env: Array<readonly [string, string | number | boolean | readonly string[]]> = [
    ["spec_version", SPEC_VERSION],
    ["content_hash", contentHash(task)],
    ["reward_kinds", rewardKinds],
  ];
  for (const [key, value] of Object.entries(task.provenance ?? {})) {
    repo2env.push([key, value]);
  }
  blocks.push(tomlTable("metadata.repo2env", repo2env), "");

  if (task.environmentDockerfile !== undefined) {
    const repro = seedReproducibility(task.environmentDockerfile);
    blocks.push(
      tomlTable("metadata.repo2env.reproducibility", [
        ["mode", repro.mode],
        ["image_ref", repro.imageRef],
        ["image_tag", repro.imageTag],
        ["image_visibility", repro.imageVisibility],
      ]),
      "",
    );
  }

  blocks.push(
    tomlTable("agent", [["timeout_sec", task.agentTimeoutSec ?? 1800.0]]),
    "",
    tomlTable("verifier", [["timeout_sec", task.verifierTimeoutSec ?? 300.0]]),
    "",
  );

  return blocks.join("\n");
}

/** Harbor's oracle agent runs this inside the container; it must leave the tree fixed ([S21]). */
const SOLVE_SH = `#!/bin/bash
set -euxo pipefail
cd /workspace
git config --global --add safe.directory /workspace
PATCH="$(dirname "$0")/patch.diff"
git apply --verbose --reject "$PATCH"
`;

/**
 * Produce every file of a Harbor task directory.
 *
 * Returns descriptors rather than touching the filesystem so this is testable and can be
 * used to build a tar for the parquet `task_binary` column the SkyRL recipe reads ([S22]).
 */
export function emitHarborTask(task: HarborTask): EmittedFile[] {
  const dir = task.name;
  const files: EmittedFile[] = [
    { path: `${dir}/task.toml`, content: renderTaskToml(task), mode: 0o644 },
    { path: `${dir}/instruction.md`, content: task.instruction, mode: 0o644 },
    { path: `${dir}/solution/patch.diff`, content: task.oracleDiff, mode: 0o644 },
    { path: `${dir}/solution/solve.sh`, content: SOLVE_SH, mode: 0o755 },
  ];

  if (task.environmentDockerfile !== undefined) {
    files.push({
      path: `${dir}/environment/Dockerfile`,
      content: task.environmentDockerfile,
      mode: 0o644,
    });
  }
  if (task.testScript !== undefined) {
    files.push({ path: `${dir}/tests/test.sh`, content: task.testScript, mode: 0o755 });
  }

  for (const [rel, content] of Object.entries(task.auxFiles ?? {})) {
    // Defensive, mirroring the Python emitter: an aux file may not escape the task dir.
    const normalized = rel.replace(/\\/g, "/");
    if (
      normalized.startsWith("/") ||
      normalized.split("/").some((segment) => segment === "..")
    ) {
      throw new HarborEmitError(`aux_file path escapes task dir: ${rel}`);
    }
    files.push({ path: `${dir}/${normalized}`, content, mode: 0o644 });
  }

  return files;
}
