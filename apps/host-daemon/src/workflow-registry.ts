// The named-workflow registry (omegacode's src/runtime/registry.ts ported onto
// bb tiers): resolve workflow definitions visible from a server-resolved
// `rootPath` across three tiers, highest precedence first:
//
//   1. project — every `<dir>/.bb/workflows/` walking up from rootPath,
//      stopping after the first directory containing `.git` (the repo
//      boundary) and never past $HOME or the filesystem root
//   2. user    — `<dataDir>/workflows/`
//   3. builtin — the workflows shipped with @bb/workflow-runtime
//
// A workflow's name is its `meta.name`, NOT its filename — files are scanned
// and meta-parsed (pure static, never executed) to match. Raw data only: the
// server runs the shared meta parser + determinism lint on resolved source
// itself (daemon-returns-raw-data rule).

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { listBuiltinWorkflows, parseWorkflow } from "@bb/workflow-runtime";
import type {
  HostDaemonWorkflowListing,
  WorkflowRegistryTier,
} from "@bb/host-daemon-contract";

/** A registry file larger than this is skipped — matches omegacode's cap. */
export const MAX_WORKFLOW_FILE_BYTES = 524_288;

export interface ListWorkflowRegistryArgs {
  /** Server-resolved project source path the project-tier walk starts from. */
  rootPath: string;
  /** Daemon data dir hosting the user tier (`<dataDir>/workflows`). */
  dataDir: string;
}

export interface ResolveWorkflowRegistryArgs extends ListWorkflowRegistryArgs {
  name: string;
}

/** Raw resolved source — the server validates (meta parse + lint) itself. */
export interface ResolvedRegistryWorkflow {
  name: string;
  content: string;
  sha256: string;
}

interface RegistryScanEntry {
  listing: HostDaemonWorkflowListing;
  source: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Project-tier directories: every `<dir>/.bb/workflows` walking up from
 * `rootPath`, nearest first (nearer shadows farther). Stops after the first
 * directory containing `.git` (the repo boundary — included, go no farther)
 * and never escapes past the home directory or the filesystem root.
 */
async function projectWorkflowDirs(rootPath: string): Promise<string[]> {
  const dirs: string[] = [];
  const home = homedir();
  let dir = resolve(rootPath);
  for (;;) {
    const candidate = join(dir, ".bb", "workflows");
    if (await pathExists(candidate)) dirs.push(candidate);
    if (await pathExists(join(dir, ".git"))) break;
    const parent = dirname(dir);
    if (dir === home || parent === dir) break;
    dir = parent;
  }
  return dirs;
}

function toScanEntry(args: {
  source: string;
  tier: WorkflowRegistryTier;
}): RegistryScanEntry {
  const { meta } = parseWorkflow(args.source);
  return {
    listing: {
      name: meta.name,
      description: meta.description,
      ...(meta.whenToUse !== undefined ? { whenToUse: meta.whenToUse } : {}),
      ...(meta.defaultProvider !== undefined
        ? { defaultProvider: meta.defaultProvider }
        : {}),
      ...(meta.defaultModel !== undefined
        ? { defaultModel: meta.defaultModel }
        : {}),
      ...(meta.defaultSandbox !== undefined
        ? { defaultSandbox: meta.defaultSandbox }
        : {}),
      tier: args.tier,
    },
    source: args.source,
  };
}

/**
 * Scan one directory for loadable workflows: `.js` files within the size cap
 * whose `meta` parses. Invalid/oversize/unreadable files are skipped — the
 * registry must never fail on a stray file. Sorted readdir keeps within-dir
 * name collisions deterministic (first occurrence wins).
 */
async function scanWorkflowDir(
  tier: WorkflowRegistryTier,
  dir: string,
): Promise<RegistryScanEntry[]> {
  let names: string[];
  try {
    names = (await fs.readdir(dir)).sort();
  } catch {
    return [];
  }
  const entries: RegistryScanEntry[] = [];
  for (const file of names) {
    if (!file.endsWith(".js")) continue;
    const filePath = join(dir, file);
    try {
      if ((await fs.stat(filePath)).size > MAX_WORKFLOW_FILE_BYTES) continue;
      entries.push(
        toScanEntry({ source: await fs.readFile(filePath, "utf8"), tier }),
      );
    } catch {
      continue; // unreadable or invalid meta — skip
    }
  }
  return entries;
}

function builtinScanEntries(): RegistryScanEntry[] {
  const entries: RegistryScanEntry[] = [];
  for (const builtin of listBuiltinWorkflows()) {
    try {
      entries.push(toScanEntry({ source: builtin.source, tier: "builtin" }));
    } catch {
      continue; // a builtin that fails meta parse is a packaging bug; skip, never crash
    }
  }
  return entries;
}

async function scanWorkflowRegistry(
  args: ListWorkflowRegistryArgs,
): Promise<RegistryScanEntry[]> {
  const tiers: { tier: WorkflowRegistryTier; dir: string }[] = [
    ...(await projectWorkflowDirs(args.rootPath)).map((dir) => ({
      tier: "project" as const,
      dir,
    })),
    { tier: "user", dir: join(args.dataDir, "workflows") },
  ];

  const seen = new Set<string>();
  const winners: RegistryScanEntry[] = [];
  for (const { tier, dir } of tiers) {
    for (const entry of await scanWorkflowDir(tier, dir)) {
      if (seen.has(entry.listing.name)) continue;
      seen.add(entry.listing.name);
      winners.push(entry);
    }
  }
  for (const entry of builtinScanEntries()) {
    if (seen.has(entry.listing.name)) continue;
    seen.add(entry.listing.name);
    winners.push(entry);
  }
  return winners;
}

/**
 * All named workflows visible from `rootPath`, winners only: project shadows
 * user shadows builtin; within a tier the first (sorted) file claiming a name
 * wins; among project dirs the nearest directory wins.
 */
export async function listWorkflowRegistry(
  args: ListWorkflowRegistryArgs,
): Promise<HostDaemonWorkflowListing[]> {
  return (await scanWorkflowRegistry(args)).map((entry) => entry.listing);
}

/**
 * Resolve one workflow by registry name with the same tier shadowing as
 * `listWorkflowRegistry`. Returns null when no tier claims the name.
 */
export async function resolveWorkflowRegistryName(
  args: ResolveWorkflowRegistryArgs,
): Promise<ResolvedRegistryWorkflow | null> {
  const winners = await scanWorkflowRegistry({
    rootPath: args.rootPath,
    dataDir: args.dataDir,
  });
  const hit = winners.find((entry) => entry.listing.name === args.name);
  if (!hit) return null;
  return {
    name: hit.listing.name,
    content: hit.source,
    sha256: createHash("sha256").update(hit.source).digest("hex"),
  };
}
