#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRelativePath = "plugins/bb-plugin-finite-state";
const frozenRelativePaths = [
  `${pluginRelativePath}/server.ts`,
  `${pluginRelativePath}/app.tsx`,
  `${pluginRelativePath}/shared/contract.ts`,
  `${pluginRelativePath}/lib/store/schema.ts`,
  `${pluginRelativePath}/lib/sync/registry.ts`,
  `${pluginRelativePath}/lib/remote/types.ts`,
  `${pluginRelativePath}/test/mock-remote/fixtures/**`,
];
const contractRelativePath = `${pluginRelativePath}/shared/contract.ts`;
const compositionRootPaths = new Set([
  `${pluginRelativePath}/server.ts`,
  `${pluginRelativePath}/app.tsx`,
]);
const dependencySections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const recovery = "file an amendment; do not edit the frozen artifact locally.";

function fail(message) {
  throw new Error(`${message}\nRecovery: ${recovery}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function rootFromArguments(argv) {
  const rootFlag = argv.indexOf("--root");
  if (rootFlag === -1) {
    return path.resolve(scriptDirectory, "../../..");
  }
  const candidate = argv[rootFlag + 1];
  if (!candidate || candidate.startsWith("--") || argv.filter((argument) => argument === "--root").length !== 1) {
    fail("--root requires exactly one directory path");
  }
  return path.resolve(candidate);
}

function acceptIdFromArguments(argv) {
  const acceptFlag = argv.indexOf("--accept");
  if (acceptFlag === -1) {
    return null;
  }
  const candidate = argv[acceptFlag + 1];
  if (!candidate || candidate.startsWith("--") || argv.filter((argument) => argument === "--accept").length !== 1) {
    fail("--accept requires exactly one amendment id");
  }
  if (!/^(?:A|AMD)-\d{3,}$/u.test(candidate)) {
    fail(`Invalid amendment id ${JSON.stringify(candidate)}`);
  }
  return candidate;
}

function baseRefFromArguments(argv) {
  const baseFlag = argv.indexOf("--base");
  if (baseFlag === -1) return null;
  const candidate = argv[baseFlag + 1];
  if (!candidate || candidate.startsWith("--") || argv.filter((argument) => argument === "--base").length !== 1) {
    fail("--base requires exactly one immutable Git revision");
  }
  return candidate;
}

async function fileHash(root, relativePath) {
  try {
    return sha256(await fs.readFile(path.join(root, relativePath)));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      fail(`Frozen artifact is missing: ${relativePath}`);
    }
    throw error;
  }
}

async function fixtureTreeHash(root) {
  const fixtureRoot = path.join(root, pluginRelativePath, "test/mock-remote/fixtures");
  const entries = [];

  async function visit(directory) {
    let children;
    try {
      children = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const childPath = path.join(directory, child.name);
      if (child.isDirectory()) {
        await visit(childPath);
      } else if (child.isFile()) {
        const relativePath = toPosix(path.relative(fixtureRoot, childPath));
        entries.push(`${relativePath}\0${sha256(await fs.readFile(childPath))}\n`);
      } else {
        fail(`Fixture tree contains a non-regular file: ${toPosix(path.relative(root, childPath))}`);
      }
    }
  }

  await visit(fixtureRoot);
  return sha256(entries.join(""));
}

async function readDependencyBaseline(root) {
  const packageJsonPath = path.join(root, pluginRelativePath, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  } catch (error) {
    fail(`Cannot parse ${toPosix(path.relative(root, packageJsonPath))}: ${error.message}`);
  }
  return Object.fromEntries(
    dependencySections.map((section) => [section, Object.fromEntries(Object.entries(manifest[section] ?? {}).sort(([left], [right]) => left.localeCompare(right, "en")))]),
  );
}

function validateBaseline(baseline) {
  if (!baseline || baseline.version !== 1 || !baseline.artifacts || !baseline.dependencyBaseline) {
    fail("frozen-artifacts.json must have version 1, artifacts, and dependencyBaseline");
  }
  for (const artifact of frozenRelativePaths) {
    const entry = baseline.artifacts[artifact];
    const hashKey = artifact.endsWith("/**") ? "treeSha256" : "sha256";
    if (!entry || !/^[a-f0-9]{64}$/u.test(entry[hashKey]) || typeof entry.active !== "boolean" || !(entry.amendment === null || /^(?:A|AMD)-\d{3,}$/u.test(entry.amendment))) {
      fail(`Invalid frozen baseline entry for ${artifact}`);
    }
  }
  for (const section of dependencySections) {
    if (!baseline.dependencyBaseline[section] || Array.isArray(baseline.dependencyBaseline[section])) {
      fail(`Invalid dependency baseline section ${section}`);
    }
  }
  if (!Number.isInteger(baseline.contractVersion) || baseline.contractVersion < 0) {
    fail("frozen-artifacts.json must record a non-negative contractVersion");
  }
}

function parseAmendments(source) {
  let fence = null;
  let unfencedSource = "";
  for (const line of source.split("\n")) {
    const marker = /^\s*(?<marker>`{3,}|~{3,})/u.exec(line)?.groups?.marker;
    if (marker) {
      if (!fence) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
    } else if (!fence) {
      unfencedSource += `${line}\n`;
    }
  }
  const amendments = new Map();
  const sections = unfencedSource.split(/^### /mu).slice(1);
  for (const section of sections) {
    const [heading, ...bodyLines] = section.split("\n");
    const idMatch = /^(?<id>(?:A|AMD)-\d{3,})\s+—/u.exec(heading);
    if (!idMatch?.groups?.id) continue;
    const body = bodyLines.join("\n");
    const status = /^- Status: (?<status>approved)$/mu.exec(body)?.groups?.status;
    const artifactsMatch = /^- Artifacts:\n(?<artifacts>(?:  - `[^`]+`\n?)+)/mu.exec(body);
    const contractVersion = /^- Contract version: (?<version>\d+|n\/a)$/mu.exec(body)?.groups?.version;
    if (!status || !artifactsMatch?.groups?.artifacts || !contractVersion) {
      continue;
    }
    const artifacts = [...artifactsMatch.groups.artifacts.matchAll(/  - `(?<path>[^`]+)`/gu)].map((match) => match.groups.path);
    amendments.set(idMatch.groups.id, { artifacts, contractVersion });
  }
  return amendments;
}

function gitText(root, arguments_) {
  return execFileSync("git", arguments_, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function priorBaseline(root, baselineRelativePath, baseRef) {
  const relativePath = toPosix(baselineRelativePath);
  const revision = baseRef ?? (() => {
    try {
      return gitText(root, ["merge-base", "HEAD", "origin/finite-state/integration"]).trim();
    } catch {
      return null;
    }
  })();
  if (!revision) return null;
  try {
    gitText(root, ["cat-file", "-e", `${revision}^{commit}`]);
  } catch {
    fail(`Immutable baseline revision is unavailable: ${revision}`);
  }
  try {
    return JSON.parse(gitText(root, ["show", `${revision}:${relativePath}`]));
  } catch {
    return null;
  }
}

function assertMonotonicBaseline(previous, current, approvedAmendments) {
  if (!previous) return;
  validateBaseline(previous);
  for (const artifact of frozenRelativePaths) {
    const before = previous.artifacts[artifact];
    const after = current.artifacts[artifact];
    const key = artifact.endsWith("/**") ? "treeSha256" : "sha256";
    if (before.active && !after.active) {
      fail(`Frozen baseline activation cannot be withdrawn: ${artifact}`);
    }
    if (!before.active && !after.active && before[key] !== after[key]) {
      fail(`Inactive baseline provenance cannot be rewritten before activation: ${artifact}`);
    }
    if (before[key] !== after[key] || (!before.active && after.active)) {
      const amendmentId = after.amendment;
      if (amendmentId === before.amendment || !amendmentId || !approvedAmendments.get(amendmentId)?.artifacts.includes(artifact)) {
        fail(`Frozen baseline change for ${artifact} requires a structured approved amendment`);
      }
    }
  }
}

async function readApprovedAmendment(root, amendmentId) {
  const amendments = await readApprovedAmendmentMap(root);
  const amendment = amendments.get(amendmentId);
  if (!amendment) {
    fail(`Amendment ${amendmentId} is not a structured approved entry (requires Status, Artifacts, and Contract version fields)`);
  }
  return amendment;
}

async function readApprovedAmendmentMap(root) {
  const amendmentPath = path.join(root, pluginRelativePath, "AMENDMENTS.md");
  return parseAmendments(await fs.readFile(amendmentPath, "utf8"));
}

async function currentContractVersion(root) {
  const source = await fs.readFile(path.join(root, contractRelativePath), "utf8");
  const match = /\bCONTRACT_VERSION\s*=\s*(?<version>\d+)/u.exec(source);
  if (!match?.groups?.version) {
    fail(`${contractRelativePath} must export a numeric CONTRACT_VERSION`);
  }
  return Number.parseInt(match.groups.version, 10);
}

async function currentHashes(root) {
  const hashes = {};
  for (const artifact of frozenRelativePaths) {
    hashes[artifact] = artifact.endsWith("/**") ? await fixtureTreeHash(root) : await fileHash(root, artifact);
  }
  return hashes;
}

function generatedBaseline(hashes, dependencyBaseline, contractVersion, amendmentId) {
  const artifacts = Object.fromEntries(frozenRelativePaths.map((artifact) => [
    artifact,
    artifact.endsWith("/**")
      ? { treeSha256: hashes[artifact], amendment: amendmentId, active: compositionRootPaths.has(artifact) }
      : { sha256: hashes[artifact], amendment: amendmentId, active: compositionRootPaths.has(artifact) },
  ]));
  return { version: 1, contractVersion, artifacts, dependencyBaseline };
}

async function accept(root, amendmentId) {
  const amendment = await readApprovedAmendment(root, amendmentId);
  const baselinePath = path.join(root, pluginRelativePath, "frozen-artifacts.json");
  const hashes = await currentHashes(root);
  const dependencies = await readDependencyBaseline(root);
  const contractVersion = await currentContractVersion(root);
  let baseline;
  try {
    baseline = JSON.parse(await fs.readFile(baselinePath, "utf8"));
    validateBaseline(baseline);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      baseline = null;
    } else {
      throw error;
    }
  }

  const changedArtifacts = frozenRelativePaths.filter((artifact) => {
    if (!baseline) return true;
    const key = artifact.endsWith("/**") ? "treeSha256" : "sha256";
    return baseline.artifacts[artifact][key] !== hashes[artifact];
  });
  const dependencyChanged = !baseline || JSON.stringify(baseline.dependencyBaseline) !== JSON.stringify(dependencies);
  const changedTargets = [...changedArtifacts, ...(dependencyChanged ? [`${pluginRelativePath}/package.json`] : [])];
  const unauthorized = changedTargets.filter((target) => !amendment.artifacts.includes(target));
  const overbroad = amendment.artifacts.filter((target) => !changedTargets.includes(target));
  if (unauthorized.length || overbroad.length) {
    fail(`Amendment ${amendmentId} must name exactly the changed baseline targets; changed: ${changedTargets.join(", ")}; approved: ${amendment.artifacts.join(", ")}`);
  }
  if (!changedTargets.length) {
    fail(`Amendment ${amendmentId} does not change any frozen baseline target`);
  }
  if (changedArtifacts.includes(contractRelativePath)) {
    if (amendment.contractVersion === "n/a" || Number.parseInt(amendment.contractVersion, 10) !== contractVersion) {
      fail(`Amendment ${amendmentId} must record Contract version: ${contractVersion}`);
    }
    if (baseline && contractVersion <= baseline.contractVersion) {
      fail(`CONTRACT_VERSION must advance above ${baseline.contractVersion} when ${contractRelativePath} changes`);
    }
  }

  const next = baseline ?? generatedBaseline(hashes, dependencies, contractVersion, amendmentId);
  if (baseline) {
    for (const artifact of changedArtifacts) {
      const key = artifact.endsWith("/**") ? "treeSha256" : "sha256";
      next.artifacts[artifact][key] = hashes[artifact];
      next.artifacts[artifact].amendment = amendmentId;
      next.artifacts[artifact].active = true;
    }
    if (dependencyChanged) {
      next.dependencyBaseline = dependencies;
    }
    if (changedArtifacts.includes(contractRelativePath)) next.contractVersion = contractVersion;
  }
  await fs.writeFile(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
  process.stdout.write(`Accepted ${amendmentId} for ${changedTargets.join(", ")}\n`);
}

async function check(root, baseRef) {
  const baselinePath = path.join(root, pluginRelativePath, "frozen-artifacts.json");
  let baseline;
  try {
    baseline = JSON.parse(await fs.readFile(baselinePath, "utf8"));
  } catch (error) {
    fail(`Cannot parse ${toPosix(path.relative(root, baselinePath))}: ${error.message}`);
  }
  validateBaseline(baseline);
  const approvedAmendments = await readApprovedAmendmentMap(root);
  assertMonotonicBaseline(priorBaseline(root, path.relative(root, baselinePath), baseRef), baseline, approvedAmendments);
  for (const artifact of frozenRelativePaths) {
    const amendmentId = baseline.artifacts[artifact].amendment;
    if (baseline.artifacts[artifact].active && amendmentId && !approvedAmendments.get(amendmentId)?.artifacts.includes(artifact)) {
      fail(`Frozen baseline for ${artifact} is not tied to a structured approved amendment`);
    }
  }
  const hashes = await currentHashes(root);
  const changed = frozenRelativePaths.filter((artifact) => {
    const key = artifact.endsWith("/**") ? "treeSha256" : "sha256";
    return baseline.artifacts[artifact].active && baseline.artifacts[artifact][key] !== hashes[artifact];
  });
  if (changed.length) {
    fail(`Frozen artifact hash mismatch: ${changed.join(", ")}`);
  }
  process.stdout.write("Frozen artifact baseline is intact.\n");
}

export { fixtureTreeHash, parseAmendments };

async function main() {
  const argv = process.argv.slice(2);
  const recognized = new Set(["--root", "--accept", "--base"]);
  for (let index = 0; index < argv.length; index += 1) {
    if (!recognized.has(argv[index])) {
      fail(`Unknown argument ${JSON.stringify(argv[index])}`);
    }
    if (!argv[index + 1] || argv[index + 1].startsWith("--")) {
      fail(`${argv[index]} requires a value`);
    }
    index += 1;
  }
  const root = rootFromArguments(argv);
  const amendmentId = acceptIdFromArguments(argv);
  const baseRef = baseRefFromArguments(argv);
  if (amendmentId) {
    await accept(root, amendmentId);
  } else {
    await check(root, baseRef);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
