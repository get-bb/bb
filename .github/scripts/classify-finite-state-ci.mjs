import { appendFileSync } from "node:fs";

const pluginRoot = "plugins/bb-plugin-finite-state/";
const integrationRef = "refs/heads/finite-state/integration";
const pluginInfrastructure = new Set([
  ".github/workflows/ci.yml",
  "package.json",
  "pnpm-lock.yaml",
  ".node-version",
  ".nvmrc",
  "scripts/ensure-native-modules.mjs",
]);

export function classifyCiScope({ eventName, ref, changedFiles }) {
  const workflowDispatch = eventName === "workflow_dispatch";
  const pluginOnly =
    changedFiles.length > 0 &&
    changedFiles.every((file) => file.startsWith(pluginRoot));
  const pluginChanged = changedFiles.some(
    (file) =>
      file.startsWith(pluginRoot) ||
      file.startsWith(".github/actions/setup-workspace/") ||
      pluginInfrastructure.has(file),
  );

  return {
    runHeavy: workflowDispatch || !pluginOnly,
    runFiniteState: workflowDispatch || ref === integrationRef || pluginChanged,
  };
}

function parseChangedFiles(value) {
  if (!value) return [];
  const parsed = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some((file) => typeof file !== "string")
  ) {
    throw new Error("CI_CHANGED_FILES_JSON must be a JSON array of file paths");
  }
  return parsed;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const result = classifyCiScope({
    eventName: process.env.CI_EVENT_NAME ?? "",
    ref: process.env.CI_REF ?? "",
    changedFiles: parseChangedFiles(process.env.CI_CHANGED_FILES_JSON),
  });
  const output = [
    `run_heavy=${result.runHeavy}`,
    `run_finite_state=${result.runFiniteState}`,
  ].join("\n");
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
  else process.stdout.write(`${output}\n`);
}
