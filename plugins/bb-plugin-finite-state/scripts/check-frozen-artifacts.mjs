#!/usr/bin/env node

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "../../..");
const pluginRoot = "plugins/bb-plugin-finite-state";
const fixtureTree = `${pluginRoot}/test/mock-remote/fixtures/**`;
const contractPath = `${pluginRoot}/shared/contract.ts`;
const packagePath = `${pluginRoot}/package.json`;
const baselinePath = `${pluginRoot}/frozen-artifacts.json`;
const amendmentPath = `${pluginRoot}/AMENDMENTS.md`;
const dependencySections = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const frozenPaths = [
  `${pluginRoot}/server.ts`,
  `${pluginRoot}/app.tsx`,
  contractPath,
  `${pluginRoot}/lib/store/schema.ts`,
  `${pluginRoot}/lib/sync/registry.ts`,
  `${pluginRoot}/lib/remote/types.ts`,
  fixtureTree,
];
const recovery = "file an amendment; do not edit the frozen artifact locally.";

function fail(message) {
  throw new Error(`${message}\nRecovery: ${recovery}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

async function hashFile(root, relativePath) {
  try {
    return sha256(await fs.readFile(path.join(root, relativePath)));
  } catch (error) {
    if (error?.code === "ENOENT") fail(`Frozen artifact is missing: ${relativePath}`);
    throw error;
  }
}

async function hashFixtureTree(root) {
  const treeRoot = path.join(root, pluginRoot, "test/mock-remote/fixtures");
  const entries = [];

  async function visit(directory) {
    let children;
    try {
      children = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const child of children.sort((left, right) =>
      left.name.localeCompare(right.name, "en"),
    )) {
      const childPath = path.join(directory, child.name);
      if (child.isDirectory()) await visit(childPath);
      else if (child.isFile()) {
        entries.push(
          `${toPosix(path.relative(treeRoot, childPath))}\0${sha256(await fs.readFile(childPath))}\n`,
        );
      } else {
        fail(`Fixture tree contains a non-regular file: ${toPosix(path.relative(root, childPath))}`);
      }
    }
  }

  await visit(treeRoot);
  return sha256(entries.join(""));
}

async function currentHashes(root) {
  return Object.fromEntries(
    await Promise.all(
      frozenPaths.map(async (relativePath) => [
        relativePath,
        relativePath === fixtureTree
          ? await hashFixtureTree(root)
          : await hashFile(root, relativePath),
      ]),
    ),
  );
}

function normalizeDependencies(manifest) {
  return Object.fromEntries(
    dependencySections.map((section) => [
      section,
      Object.fromEntries(
        Object.entries(manifest[section] ?? {}).sort(([left], [right]) =>
          left.localeCompare(right, "en"),
        ),
      ),
    ]),
  );
}

async function readJson(root, relativePath) {
  try {
    return JSON.parse(await fs.readFile(path.join(root, relativePath), "utf8"));
  } catch (error) {
    fail(`Cannot parse ${relativePath}: ${error.message}`);
  }
}

function validateBaseline(baseline) {
  if (
    baseline?.version !== 1 ||
    !Number.isInteger(baseline.contractVersion) ||
    baseline.contractVersion < 0 ||
    !baseline.artifacts ||
    !baseline.dependencyBaseline
  ) {
    fail("frozen-artifacts.json has an invalid top-level contract");
  }
  const actualPaths = Object.keys(baseline.artifacts).sort();
  const expectedPaths = [...frozenPaths].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    fail("frozen-artifacts.json must retain the fixed frozen-artifact scope");
  }
  for (const relativePath of frozenPaths) {
    const entry = baseline.artifacts[relativePath];
    const hash = entry?.[relativePath === fixtureTree ? "treeSha256" : "sha256"];
    if (
      !/^[a-f0-9]{64}$/u.test(hash ?? "") ||
      typeof entry.active !== "boolean" ||
      !(entry.amendment === null || /^(?:A|AMD)-\d{3,}$/u.test(entry.amendment))
    ) {
      fail(`Invalid frozen baseline entry for ${relativePath}`);
    }
  }
  for (const section of dependencySections) {
    const value = baseline.dependencyBaseline[section];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail(`Invalid dependency baseline section ${section}`);
    }
  }
  if (
    !(
      baseline.dependencyBaseline.amendment === null ||
      /^(?:A|AMD)-\d{3,}$/u.test(baseline.dependencyBaseline.amendment)
    )
  ) {
    fail("Invalid dependency baseline amendment");
  }
}

function withoutFencedBlocks(source) {
  const kept = [];
  let fence = null;
  for (const line of source.split("\n")) {
    if (fence) {
      const closing = new RegExp(
        `^ {0,3}${fence.character}{${fence.length},}[\\t ]*$`,
        "u",
      );
      if (closing.test(line)) fence = null;
      continue;
    }
    const opening = /^ {0,3}(?<marker>`{3,}|~{3,})/u.exec(line)?.groups?.marker;
    if (opening) {
      fence = { character: opening[0], length: opening.length };
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

function parseAmendments(source) {
  const amendments = new Map();
  const sections = withoutFencedBlocks(source).split(/^### /mu).slice(1);
  for (const section of sections) {
    const [heading, ...bodyLines] = section.split("\n");
    const id = /^(?<id>(?:A|AMD)-\d{3,})\s+—/u.exec(heading)?.groups?.id;
    const body = bodyLines.join("\n");
    const approved = /^- Status: approved$/mu.test(body);
    const artifactBlock = /^- Artifacts:\n(?<items>(?:  - `[^`]+`\n?)+)/mu.exec(body)?.groups?.items;
    const contractVersion = /^- Contract version: (?<value>\d+|n\/a)$/mu.exec(body)?.groups?.value;
    if (!id || !approved || !artifactBlock || !contractVersion) continue;
    const artifacts = [...artifactBlock.matchAll(/  - `(?<path>[^`]+)`/gu)].map(
      (match) => match.groups.path,
    );
    amendments.set(id, { artifacts, contractVersion });
  }
  return amendments;
}

async function amendmentMap(root) {
  return parseAmendments(await fs.readFile(path.join(root, amendmentPath), "utf8"));
}

async function currentContractVersion(root) {
  const source = await fs.readFile(path.join(root, contractPath), "utf8");
  const value = /\bCONTRACT_VERSION\s*=\s*(?<value>\d+)/u.exec(source)?.groups?.value;
  if (!value) fail(`${contractPath} must export a numeric CONTRACT_VERSION`);
  return Number.parseInt(value, 10);
}

async function check(root) {
  const baseline = await readJson(root, baselinePath);
  validateBaseline(baseline);
  const amendments = await amendmentMap(root);
  const hashes = await currentHashes(root);
  const changed = frozenPaths.filter((relativePath) => {
    const entry = baseline.artifacts[relativePath];
    const key = relativePath === fixtureTree ? "treeSha256" : "sha256";
    if (entry.active && entry.amendment) {
      const amendment = amendments.get(entry.amendment);
      if (!amendment?.artifacts.includes(relativePath)) {
        fail(`Frozen baseline for ${relativePath} lacks a structured approved amendment`);
      }
    }
    return entry.active && entry[key] !== hashes[relativePath];
  });
  if (changed.length) fail(`Frozen artifact hash mismatch: ${changed.join(", ")}`);
  process.stdout.write("Frozen artifact baseline is intact.\n");
}

async function accept(root, amendmentId) {
  const baseline = await readJson(root, baselinePath);
  validateBaseline(baseline);
  if (baseline.dependencyBaseline.amendment === amendmentId) {
    fail(
      `Amendment ${amendmentId} is already recorded for ${packagePath} and cannot be reused`,
    );
  }
  const recordedPath = frozenPaths.find(
    (relativePath) => baseline.artifacts[relativePath].amendment === amendmentId,
  );
  if (recordedPath) {
    fail(
      `Amendment ${amendmentId} is already recorded for ${recordedPath} and cannot be reused`,
    );
  }
  const amendment = (await amendmentMap(root)).get(amendmentId);
  if (!amendment) {
    fail(
      `Amendment ${amendmentId} is not a structured approved entry ` +
        "(requires Status, Artifacts, and Contract version fields)",
    );
  }
  const hashes = await currentHashes(root);
  const manifest = await readJson(root, packagePath);
  const dependencies = normalizeDependencies(manifest);
  const changedArtifacts = frozenPaths.filter((relativePath) => {
    const key = relativePath === fixtureTree ? "treeSha256" : "sha256";
    return baseline.artifacts[relativePath][key] !== hashes[relativePath];
  });
  const dependencyChanged =
    dependencySections.some(
      (section) =>
        JSON.stringify(baseline.dependencyBaseline[section]) !==
        JSON.stringify(dependencies[section]),
    );
  const changedTargets = [
    ...changedArtifacts,
    ...(dependencyChanged ? [packagePath] : []),
  ].sort();
  const approvedTargets = [...amendment.artifacts].sort();
  if (
    changedTargets.length === 0 ||
    JSON.stringify(changedTargets) !== JSON.stringify(approvedTargets)
  ) {
    fail(
      `Amendment ${amendmentId} must name exactly the changed baseline targets; ` +
        `changed: ${changedTargets.join(", ")}; approved: ${approvedTargets.join(", ")}`,
    );
  }
  if (changedArtifacts.includes(contractPath)) {
    const version = await currentContractVersion(root);
    if (
      amendment.contractVersion === "n/a" ||
      Number.parseInt(amendment.contractVersion, 10) !== version ||
      version <= baseline.contractVersion
    ) {
      fail(`Amendment ${amendmentId} must advance Contract version above ${baseline.contractVersion}`);
    }
    baseline.contractVersion = version;
  }
  for (const relativePath of changedArtifacts) {
    const key = relativePath === fixtureTree ? "treeSha256" : "sha256";
    baseline.artifacts[relativePath][key] = hashes[relativePath];
    baseline.artifacts[relativePath].active = true;
    baseline.artifacts[relativePath].amendment = amendmentId;
  }
  if (dependencyChanged) {
    baseline.dependencyBaseline = {
      amendment: amendmentId,
      ...dependencies,
    };
  }
  await fs.writeFile(
    path.join(root, baselinePath),
    `${JSON.stringify(baseline, null, 2)}\n`,
  );
  process.stdout.write(`Accepted ${amendmentId} for ${changedTargets.join(", ")}\n`);
}

function parseArguments(argv) {
  let root = repositoryRoot;
  let amendmentId = null;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
    if (flag === "--root") root = path.resolve(value);
    else if (flag === "--accept") amendmentId = value;
    else fail(`Unknown argument ${JSON.stringify(flag)}`);
  }
  if (amendmentId && !/^(?:A|AMD)-\d{3,}$/u.test(amendmentId)) {
    fail(`Invalid amendment id ${JSON.stringify(amendmentId)}`);
  }
  return { amendmentId, root };
}

export { parseAmendments };

async function main() {
  const { amendmentId, root } = parseArguments(process.argv.slice(2));
  if (amendmentId) await accept(root, amendmentId);
  else await check(root);
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(scriptPath)
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
