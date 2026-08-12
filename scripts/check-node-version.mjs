import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const REQUIRED_NODE_RANGE = "22.19.x";
export const REQUIRED_NODE_MODULES_ABI = "127";

const requiredVersion = /^(\d+)\.(\d+)\.x$/u.exec(REQUIRED_NODE_RANGE);
if (requiredVersion === null) {
  throw new Error(`Invalid REQUIRED_NODE_RANGE: ${REQUIRED_NODE_RANGE}`);
}
const [, requiredMajor, requiredMinor] = requiredVersion;

export function checkNodeRuntime({ nodeVersion, modulesAbi }) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(nodeVersion);
  const versionMatches =
    match !== null && match[1] === requiredMajor && match[2] === requiredMinor;
  const abiMatches = modulesAbi === REQUIRED_NODE_MODULES_ABI;

  if (versionMatches && abiMatches) {
    return { ok: true };
  }

  return {
    ok: false,
    message:
      `[check-node-version] Expected Node ${REQUIRED_NODE_RANGE} ` +
      `(NODE_MODULE_VERSION ${REQUIRED_NODE_MODULES_ABI}), but found ` +
      `Node ${nodeVersion} (NODE_MODULE_VERSION ${modulesAbi}). ` +
      "Activate the runtime pinned by .node-version or .nvmrc before running pnpm install.",
  };
}

function main() {
  const result = checkNodeRuntime({
    nodeVersion: process.versions.node,
    modulesAbi: process.versions.modules,
  });
  if (!result.ok) {
    console.error(result.message);
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  realpathSync(entrypoint) === realpathSync(fileURLToPath(import.meta.url))
) {
  main();
}
