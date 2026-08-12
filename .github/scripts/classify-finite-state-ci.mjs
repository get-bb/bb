import { appendFileSync } from "node:fs";

const pluginRoot = "plugins/bb-plugin-finite-state/";

export function classifyCiScope({ eventName, changedFiles }) {
  const workflowDispatch = eventName === "workflow_dispatch";
  const pluginOnly =
    changedFiles.length > 0 &&
    changedFiles.every((file) => file.startsWith(pluginRoot));

  return {
    runHeavy: workflowDispatch || !pluginOnly,
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
    changedFiles: parseChangedFiles(process.env.CI_CHANGED_FILES_JSON),
  });
  const output = `run_heavy=${result.runHeavy}`;
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
  else process.stdout.write(`${output}\n`);
}
