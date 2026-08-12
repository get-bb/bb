import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const workflowDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(workflowDirectory, "..", "..");
const manifestPath = join(
  repositoryRoot,
  "plugins/bb-plugin-finite-state/docs/Implementation/scheduling/wp-coupling-manifest.json",
);

const workflowShapes = {
  "fs-amendment-impact.js": {
    phases: ["Analyse", "Draft"],
    requiredArgs: ["amendment"],
    editingPhases: [],
    selections: { "fs-review": 1, "fs-critical": 1 },
  },
  "fs-contract-freeze.js": {
    phases: ["Review", "Refute", "Brief"],
    requiredArgs: ["target"],
    editingPhases: [],
    selections: { "fs-review": 1, "fs-critical": 1 },
  },
  "fs-gate-review.js": {
    phases: ["Execute", "Verify", "Rule"],
    requiredArgs: ["gate"],
    editingPhases: [],
    selections: { "fs-review": 1, "fs-critical": 2 },
  },
  "fs-work-package.js": {
    phases: ["Preflight", "Implement", "Review", "Repair", "Verify", "Report"],
    requiredArgs: ["taskKey", "profile"],
    editingPhases: ["Implement", "Repair"],
    selections: { "fs-standard": 1, "fs-critical": 1, "fs-review": 1 },
  },
};

function readMeta(source, fileName) {
  const prefix = "export const meta = ";
  assert.ok(source.startsWith(prefix), `${fileName}: meta must be the first declaration`);
  const end = source.indexOf(";\n", prefix.length);
  assert.notEqual(end, -1, `${fileName}: meta declaration must end with a semicolon`);
  const literal = source.slice(prefix.length, end);
  return Function(`"use strict"; return (${literal});`)();
}

function readEditingPhases(source, fileName) {
  const match = source.match(/const EDITING_PHASES = (\[[^\n]*\]);/);
  assert.ok(match, `${fileName}: declare EDITING_PHASES`);
  return JSON.parse(match[1]);
}

function literalSelections(source, fileName) {
  const providers = [...source.matchAll(/\bprovider:\s*"([^"]+)"/g)].map((match) => match[1]);
  const models = [...source.matchAll(/\bmodel:\s*"([^"]+)"/g)].map((match) => match[1]);
  const reasoningLevels = [...source.matchAll(/\breasoningLevel:\s*"([^"]+)"/g)].map(
    (match) => match[1],
  );
  const agentCalls = [...source.matchAll(/\bagent\s*\(/g)].length;

  assert.equal(models.length, providers.length, `${fileName}: every provider needs one model`);
  assert.equal(
    reasoningLevels.length,
    providers.length,
    `${fileName}: every provider needs one reasoningLevel`,
  );
  assert.equal(
    agentCalls,
    providers.length,
    `${fileName}: every agent path must select a literal policy tuple; inheritance is forbidden`,
  );

  return providers.map((provider, index) => ({
    provider,
    model: models[index],
    reasoningEffort: reasoningLevels[index],
  }));
}

function acceptsClosedArgs(schema, value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (schema.required.some((key) => !(key in value))) return false;
  if (schema.additionalProperties === false) {
    if (Object.keys(value).some((key) => !(key in schema.properties))) return false;
  }
  return Object.entries(value).every(([key, fieldValue]) => {
    const field = schema.properties[key];
    if (field.enum && !field.enum.includes(fieldValue)) return false;
    if (field.type === "string" && typeof fieldValue !== "string") return false;
    if (field.minLength && fieldValue.length < field.minLength) return false;
    return true;
  });
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const policyTuples = new Map(
  Object.entries(manifest.presets).map(([name, selection]) => [
    JSON.stringify(selection),
    name,
  ]),
);

for (const [fileName, shape] of Object.entries(workflowShapes)) {
  const source = await readFile(join(workflowDirectory, fileName), "utf8");
  const meta = readMeta(source, fileName);

  assert.deepEqual(
    meta.phases.map((phase) => phase.title),
    shape.phases,
    `${fileName}: declared phase shape changed`,
  );
  assert.deepEqual(meta.inputSchema.required, shape.requiredArgs, `${fileName}: required args changed`);
  assert.equal(meta.inputSchema.additionalProperties, false, `${fileName}: args must be closed`);
  assert.deepEqual(
    readEditingPhases(source, fileName),
    shape.editingPhases,
    `${fileName}: mutation boundary changed`,
  );

  const concurrencyMatch = source.match(/const MAX_CONCURRENT_AGENTS = (\d+);/);
  assert.ok(concurrencyMatch, `${fileName}: declare MAX_CONCURRENT_AGENTS`);
  assert.equal(
    Number(concurrencyMatch[1]),
    manifest.dispatchPolicy.currentLaneCap,
    `${fileName}: concurrency must match the current FS-93 lane cap`,
  );
  assert.equal(
    [...source.matchAll(/\bparallel\s*\(/g)].length,
    1,
    `${fileName}: parallel work must pass through parallelWithinCap`,
  );
  assert.ok(source.includes("parallelWithinCap("), `${fileName}: capped parallel helper is unused`);

  const actualSelections = {};
  for (const selection of literalSelections(source, fileName)) {
    const preset = policyTuples.get(JSON.stringify(selection));
    assert.ok(preset, `${fileName}: tuple is not an authoritative FS-93 preset: ${JSON.stringify(selection)}`);
    actualSelections[preset] = (actualSelections[preset] ?? 0) + 1;
  }
  assert.deepEqual(actualSelections, shape.selections, `${fileName}: model-selection shape changed`);

  assert.equal(source.includes("claude-" + "sonnet-5"), false, `${fileName}: stale reviewer model`);
  assert.doesNotMatch(source, /\b(?:git merge|gh pr merge|gh pr review --approve|bb tasks dispatch)\b/);
  assert.doesNotMatch(source, /bb tasks update[^\n]*--status (?:done|canceled)/);
  assert.match(
    source,
    /Never merge|Do not [^"\n]*merge|no agent may merge/i,
    `${fileName}: merge prohibition is missing`,
  );
}

const workPackage = await readFile(join(workflowDirectory, "fs-work-package.js"), "utf8");
const workPackageMeta = readMeta(workPackage, "fs-work-package.js");
assert.equal(
  acceptsClosedArgs(workPackageMeta.inputSchema, { taskKey: "FS-24", profile: "fs-standard" }),
  true,
  "fs-work-package.js: valid closed profile input must be accepted",
);
assert.equal(
  acceptsClosedArgs(workPackageMeta.inputSchema, { taskKey: "FS-24" }),
  false,
  "fs-work-package.js: a missing profile must be rejected",
);
assert.equal(
  acceptsClosedArgs(workPackageMeta.inputSchema, { taskKey: "FS-24", profile: "fs-review" }),
  false,
  "fs-work-package.js: an unknown work profile must be rejected",
);
assert.equal(
  [...workPackage.matchAll(/await editingAgent\s*\(/g)].length,
  2,
  "fs-work-package.js: only implement and repair may invoke an editing agent",
);
assert.match(workPackage, /phase: "Implement"/);
assert.match(workPackage, /phase: "Repair"/);
for (const readinessInvariant of [
  "validate-wp-coupling.mjs",
  "every effective dependency is done",
  "decision-owner cluster",
  "lowest incomplete sequence",
  "dispatchPolicy.currentLaneCap",
]) {
  assert.ok(workPackage.includes(readinessInvariant), `fs-work-package.js: missing ${readinessInvariant}`);
}
for (const reportBoundary of [
  "OPERATIONAL REPORT BOUNDARY",
  "open a draft PR",
  "set that task to in_review",
  "Do not merge, change any gate, approve anything, or mint human authorization",
]) {
  assert.ok(workPackage.includes(reportBoundary), `fs-work-package.js: missing ${reportBoundary}`);
}

console.log(
  `Validated ${Object.keys(workflowShapes).length} Finite State workflows against FS-93: tuples, closed args, declared phases, mutation boundary, readiness, and concurrency cap ${manifest.dispatchPolicy.currentLaneCap}.`,
);
