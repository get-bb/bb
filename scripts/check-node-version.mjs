import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_NODE_RANGE = "22.19.x";
export const REQUIRED_NODE_MODULES_ABI = "127";

export function checkNodeRuntime({ nodeVersion, modulesAbi }) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(nodeVersion);
  const versionMatches =
    match !== null && Number(match[1]) === 22 && Number(match[2]) === 19;
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
  resolve(entrypoint) === fileURLToPath(import.meta.url)
) {
  main();
}
