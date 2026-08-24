/**
 * Golden capture and projection shared by the capture script and the test.
 * A golden holds stable projections only: temp paths are replaced by
 * `<home>` / `<root>` and both lists are sorted, so two runs on different
 * temp roots compare equal. What it proves: every root, name, description
 * and path the discovery pipeline lists. What it does not prove: a skill's
 * `id` — the identity seed hashes the resolved root path, which for the
 * plugin and config-file roots is the temp root itself, so two captures
 * never agree on it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DiscoveredSkill,
  HostProviderCommand,
} from "@bb/host-daemon-contract";
import {
  createFixturePaths,
  type ExpectedNames,
  type FixtureEnv,
  type FixturePaths,
  type FixtureVariant,
  NATIVE_ROOT_ENV_KEYS,
  removeFixturePaths,
} from "./fixtures.js";
import type { Pipeline, PipelineOutput } from "./pipeline.js";

export type GoldenCommand = Pick<
  HostProviderCommand,
  "name" | "source" | "origin" | "description" | "argumentHint"
>;
export type GoldenSkill = Pick<
  DiscoveredSkill,
  "name" | "description" | "filePath" | "rootKind" | "linked"
>;
export interface GoldenSection {
  commands: GoldenCommand[];
  skills: GoldenSkill[];
}
export interface GoldenFile {
  providerId: string;
  variant: string;
  workspace: GoldenSection;
  userOnly: GoldenSection;
}

/**
 * Apply the variant env for the duration of a capture. Every key the daemon
 * reads is set or cleared, so the host's own env never leaks in. Returns the
 * restore function.
 */
export type ApplyEnv = (
  env: Readonly<Record<string, string | undefined>>,
) => () => void;

export function fullFixtureEnv(
  env: FixtureEnv,
): Record<string, string | undefined> {
  return Object.fromEntries(NATIVE_ROOT_ENV_KEYS.map((key) => [key, env[key]]));
}

/** `applyEnv` for plain Node: mutate `process.env` and restore afterwards. */
export const applyProcessEnv: ApplyEnv = (env) => {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
};

function placeholderPath(value: string, paths: FixturePaths): string {
  return value
    .split(paths.home)
    .join("<home>")
    .split(paths.root)
    .join("<root>");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function projectSection(
  output: PipelineOutput,
  paths: FixturePaths,
): GoldenSection {
  const commands = output.commands
    .map((command) => ({
      name: command.name,
      source: command.source,
      origin: command.origin,
      description: command.description,
      argumentHint: command.argumentHint,
    }))
    .sort(
      (left, right) =>
        compareStrings(left.name, right.name) ||
        compareStrings(JSON.stringify(left), JSON.stringify(right)),
    );
  const skills = output.skills
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      filePath: placeholderPath(skill.filePath, paths),
      rootKind: skill.rootKind,
      linked: skill.linked,
    }))
    .sort(
      (left, right) =>
        compareStrings(left.name, right.name) ||
        compareStrings(left.filePath, right.filePath),
    );
  return { commands, skills };
}

export class FixtureExpectationError extends Error {}

function assertExpectedNames(
  label: string,
  section: GoldenSection,
  expected: ExpectedNames,
): void {
  const names = new Set([
    ...section.commands.map((command) => command.name),
    ...section.skills.map((skill) => skill.name),
  ]);
  const missing = expected.present.filter((name) => !names.has(name));
  const unexpected = expected.absent.filter((name) => names.has(name));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new FixtureExpectationError(
      `${label}: fixture expectation failed` +
        (missing.length > 0 ? `; missing ${JSON.stringify(missing)}` : "") +
        (unexpected.length > 0
          ? `; unexpectedly present ${JSON.stringify(unexpected)}`
          : ""),
    );
  }
}

/**
 * Build the variant's fixture in a fresh temp root, run `pipeline` with the
 * workspace cwd and with `cwd: null`, and project both results. Fixture
 * expectations (one name per populated root, the negatives absent) are
 * checked so a fixture that populates a root the code never scans fails here
 * instead of producing a thin golden.
 */
export async function captureVariant(
  variant: FixtureVariant,
  pipeline: Pipeline,
  applyEnv: ApplyEnv,
): Promise<GoldenFile> {
  const paths = await createFixturePaths();
  const env = variant.env(paths);
  const restoreEnv = applyEnv(fullFixtureEnv(env));
  try {
    await variant.build(paths);
    const run = (cwd: string | null): Promise<PipelineOutput> =>
      pipeline({
        providerId: variant.providerId,
        cwd,
        homeDir: paths.home,
      });
    const workspace = projectSection(await run(paths.cwd), paths);
    const userOnly = projectSection(await run(null), paths);
    const label = `${variant.providerId}.${variant.variant}`;
    assertExpectedNames(
      `${label} workspace`,
      workspace,
      variant.expected.workspace,
    );
    assertExpectedNames(
      `${label} userOnly`,
      userOnly,
      variant.expected.userOnly,
    );
    return {
      providerId: variant.providerId,
      variant: variant.variant,
      workspace,
      userOnly,
    };
  } finally {
    restoreEnv();
    await removeFixturePaths(paths);
  }
}

const GOLDENS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "goldens",
);

export function goldenFilePath(variant: FixtureVariant): string {
  const suffix = variant.variant === "default" ? "" : `.${variant.variant}`;
  return path.join(GOLDENS_DIR, `${variant.providerId}${suffix}.json`);
}

export async function readGolden(variant: FixtureVariant): Promise<GoldenFile> {
  const content = await fs.readFile(goldenFilePath(variant), "utf8");
  // The golden is our own serialized `GoldenFile`; the test compares it
  // structurally, so a malformed file fails the comparison.
  return JSON.parse(content) as GoldenFile;
}

export async function writeGolden(
  variant: FixtureVariant,
  golden: GoldenFile,
): Promise<void> {
  await fs.mkdir(GOLDENS_DIR, { recursive: true });
  await fs.writeFile(
    goldenFilePath(variant),
    `${JSON.stringify(golden, null, 2)}\n`,
    "utf8",
  );
}
