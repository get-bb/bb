import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { BbPluginApi } from "@bb/plugin-sdk";
import { requirementIdSchema } from "../cards/schema.js";
import type { GitCommitProvenance } from "./resolvers.js";

const MAX_REQUIREMENT_BYTES = 1_000_000;
const MAX_GIT_OUTPUT_BYTES = 32_000;
const GIT_TIMEOUT_MS = 5_000;
const cache = new Map<string, Promise<GitCommitProvenance | { error: string } | null>>();

export interface GitHistoryRunner {
  run(cwd: string, args: readonly string[]): Promise<string>;
}

const systemRunner: GitHistoryRunner = {
  run(cwd, args) {
    return new Promise((resolveOutput, reject) => {
      execFile(
        "git",
        [...args],
        {
          cwd,
          encoding: "utf8",
          maxBuffer: MAX_GIT_OUTPUT_BYTES,
          timeout: GIT_TIMEOUT_MS,
          windowsHide: true,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_OPTIONAL_LOCKS: "0",
            LC_ALL: "C",
          },
        },
        (error, stdout) => {
          if (error) reject(error);
          else resolveOutput(stdout);
        },
      );
    });
  },
};

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:authorization|bearer\s|api[_-]?key|token=|https?:\/\/[^\s]*[?@])/giu, "[redacted]")
    .replaceAll("\n", " ")
    .slice(0, 400);
}

function confinedPath(root: string, artifactId: string): string | null {
  const absolute = resolve(root, artifactId);
  const child = relative(resolve(root), absolute);
  if (!child || child === ".." || child.startsWith(`..${sep}`) || resolve(child) === child) {
    return null;
  }
  return absolute;
}

async function resolveGitHistory(
  bb: BbPluginApi,
  projectId: string,
  requirementId: string,
  expectedDigest: string,
  runner: GitHistoryRunner,
): Promise<GitCommitProvenance | { error: string } | null> {
  const id = requirementIdSchema.safeParse(requirementId);
  if (!id.success) return { error: "Requirement id is malformed; git history was not invoked." };
  const project = await bb.sdk.projects.get({ projectId });
  const source = project.sources.find((candidate) => candidate.isDefault) ?? project.sources[0];
  if (!source) return { error: "Project has no workspace source for git provenance." };
  const artifactId = `product-security/requirements/${id.data}.yaml`;
  const absolute = confinedPath(source.path, artifactId);
  if (!absolute) return { error: "Known requirement path failed confinement." };

  try {
    const info = await stat(absolute);
    if (!info.isFile() || info.size > MAX_REQUIREMENT_BYTES) {
      return { error: "Known requirement file is unavailable or exceeds the safety bound." };
    }
    const localBytes = await readFile(absolute);
    const digest = createHash("sha256").update(localBytes).digest("hex");
    if (digest !== expectedDigest) {
      return {
        error: "Workspace source is remote or differs from the indexed file; git provenance is unavailable on this host.",
      };
    }
    const output = await runner.run(source.path, [
      "log",
      "--follow",
      "-n",
      "1",
      "--format=%H%x00%aI%x00%an%x00%s",
      "--",
      artifactId,
    ]);
    const line = output.split(/\r?\n/u)[0];
    if (!line) return null;
    const [hash, at, author, subject] = line.split("\0");
    if (!hash || !/^[a-f0-9]{40,64}$/u.test(hash) || !at || !author || subject === undefined) {
      return { error: "Git history returned an invalid bounded record." };
    }
    return {
      hash,
      at,
      author: author.slice(0, 200),
      subject: subject.slice(0, 300),
      artifactId,
    };
  } catch (error) {
    return { error: `Git history unavailable: ${safeError(error)}` };
  }
}

export function getRequirementGitHistory(
  bb: BbPluginApi,
  projectId: string,
  requirementId: string,
  expectedDigest: string | null,
  runner: GitHistoryRunner = systemRunner,
): Promise<GitCommitProvenance | { error: string } | null> {
  if (!expectedDigest || !/^[a-f0-9]{64}$/u.test(expectedDigest)) {
    return Promise.resolve({ error: "Tracked file digest is unavailable; git provenance was not invoked." });
  }
  const key = `${projectId}:${requirementId}:${expectedDigest}`;
  const current = cache.get(key);
  if (current) return current;
  const pending = resolveGitHistory(bb, projectId, requirementId, expectedDigest, runner);
  cache.set(key, pending);
  pending.catch(() => cache.delete(key));
  return pending;
}
