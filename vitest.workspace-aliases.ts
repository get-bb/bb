import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export const workspaceTestAliases = {
  "@bb/agent-providers": path.resolve(
    repoRoot,
    "packages/agent-providers/src/index.ts",
  ),
  "@bb/secret-storage": path.resolve(
    repoRoot,
    "packages/secret-storage/src/index.ts",
  ),
  "@bb/agent-runtime/test": path.resolve(
    repoRoot,
    "packages/agent-runtime/src/test/index.ts",
  ),
  "@bb/agent-runtime/capture": path.resolve(
    repoRoot,
    "packages/agent-runtime/src/capture.ts",
  ),
  "@bb/agent-runtime/shared/json-rpc-envelope": path.resolve(
    repoRoot,
    "packages/agent-runtime/src/shared/json-rpc-envelope.ts",
  ),
  "@bb/agent-runtime": path.resolve(
    repoRoot,
    "packages/agent-runtime/src/index.ts",
  ),
  "@bb/config/common": path.resolve(repoRoot, "packages/config/src/common.ts"),
  "@bb/config/defaults": path.resolve(
    repoRoot,
    "packages/config/src/defaults.ts",
  ),
  "@bb/config/host-daemon": path.resolve(
    repoRoot,
    "packages/config/src/host-daemon.ts",
  ),
  "@bb/domain/thread-status": path.resolve(
    repoRoot,
    "packages/domain/src/thread-status.ts",
  ),
  "@bb/domain": path.resolve(repoRoot, "packages/domain/src/index.ts"),
  "@bb/templates/generated": path.resolve(
    repoRoot,
    "packages/templates/src/generated/templates.generated.ts",
  ),
  "@bb/templates": path.resolve(repoRoot, "packages/templates/src/index.ts"),
  "@bb/test-helpers": path.resolve(
    repoRoot,
    "packages/test-helpers/src/index.ts",
  ),
  "@bb/db/internal-environment-lifecycle": path.resolve(
    repoRoot,
    "packages/db/src/internal-environment-lifecycle.ts",
  ),
  "@bb/db": path.resolve(repoRoot, "packages/db/src/index.ts"),
  "@bb/host-daemon-contract": path.resolve(
    repoRoot,
    "packages/host-daemon-contract/src/index.ts",
  ),
  "@bb/host-workspace": path.resolve(
    repoRoot,
    "packages/host-workspace/src/index.ts",
  ),
  "@bb/host-watcher": path.resolve(
    repoRoot,
    "packages/host-watcher/src/index.ts",
  ),
  "@bb/host-daemon/test": path.resolve(
    repoRoot,
    "apps/host-daemon/src/test/index.ts",
  ),
  "@bb/server": path.resolve(repoRoot, "apps/server/src/index.ts"),
  "@bb/cli": path.resolve(repoRoot, "apps/cli/src/index.ts"),
  "@bb/logger": path.resolve(repoRoot, "packages/logger/src/index.ts"),
  "@bb/config/server": path.resolve(repoRoot, "packages/config/src/server.ts"),
  "@bb/server-contract": path.resolve(
    repoRoot,
    "packages/server-contract/src/index.ts",
  ),
  "@bb/sdk/core": path.resolve(repoRoot, "packages/sdk/src/core.ts"),
  "@bb/sdk/node-websocket": path.resolve(
    repoRoot,
    "packages/sdk/src/node-websocket.ts",
  ),
  "@bb/sdk/node": path.resolve(repoRoot, "packages/sdk/src/node.ts"),
  "@bb/sdk/browser": path.resolve(repoRoot, "packages/sdk/src/browser.ts"),
  // Must match the package.json "." export so the same specifier resolves to
  // the same module under vitest and tsc/production.
  "@bb/sdk": path.resolve(repoRoot, "packages/sdk/src/node.ts"),
} as const;
