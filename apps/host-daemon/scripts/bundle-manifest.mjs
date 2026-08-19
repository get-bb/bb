import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptsDir, "..");
const workspaceRoot = resolve(packageRoot, "..", "..");

export const NODE_ESM_REQUIRE_BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { dirname as __pathDirname } from "node:path";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  "const require = __createRequire(import.meta.url);",
  "const __filename = __fileURLToPath(import.meta.url);",
  "const __dirname = __pathDirname(__filename);",
].join("");

export const bundleTargets = [
  {
    banner: NODE_ESM_REQUIRE_BANNER,
    entryPoint: resolve(packageRoot, "src", "index.ts"),
    label: "daemon",
    outfile: resolve(packageRoot, "dist", "daemon-bundle.mjs"),
  },
  {
    banner: NODE_ESM_REQUIRE_BANNER,
    entryPoint: resolve(
      workspaceRoot,
      "packages",
      "agent-runtime",
      "src",
      "pi",
      "bridge",
      "bridge.ts",
    ),
    // Pi extensions import the host's Pi modules. Keep the pinned Pi package
    // tree on disk so Pi's extension loader can resolve those shared modules.
    externalPackages: [
      "@earendil-works/pi-ai",
      "@earendil-works/pi-coding-agent",
    ],
    label: "pi bridge",
    outfile: resolve(packageRoot, "dist", "bb-pi-bridge.mjs"),
  },
  {
    // The bootstrap the runtime spawns for EVERY bridge, artifact or bundled:
    // it imports the bridge module out of a `bb.host` artifact and owns the
    // process boundary. Emitted beside the bundled bridges it also launches.
    banner: NODE_ESM_REQUIRE_BANNER,
    entryPoint: resolve(
      workspaceRoot,
      "packages",
      "provider-bridge-protocol",
      "src",
      "bridge-worker-entry.ts",
    ),
    label: "provider bridge worker",
    outfile: resolve(packageRoot, "dist", "bb-provider-bridge-worker.mjs"),
  },
  {
    // Forked child that runs a plugin's `bb.host` entry (plugin-host-manager.ts).
    // Emitted next to the daemon bundle so defaultWorkerEntryPath resolves it as
    // a sibling in the packaged app.
    banner: NODE_ESM_REQUIRE_BANNER,
    entryPoint: resolve(packageRoot, "src", "plugin-host-worker.ts"),
    label: "plugin host worker",
    outfile: resolve(packageRoot, "dist", "bb-plugin-host-worker.mjs"),
  },
  {
    banner: NODE_ESM_REQUIRE_BANNER,
    entryPoint: resolve(workspaceRoot, "apps", "cli", "src", "index.ts"),
    executable: true,
    label: "bb cli",
    outfile: resolve(packageRoot, "dist", "bb"),
    // The packaged CLI has no workspace on disk, so `bb plugin types` for a
    // vendored-layout plugin gets the SDK declarations inlined (see
    // packages/templates/src/plugin-sdk-dts.ts). Dev bundles read them from
    // packages/plugin-sdk/bundled-types instead.
    inlinePluginSdkDeclarations: true,
  },
  {
    // Forked child that runs @parcel/watcher in isolation (BB_WATCHER_SUBPROCESS=1).
    // Emitted next to the daemon bundle so fork-channel resolves it as a sibling.
    banner: NODE_ESM_REQUIRE_BANNER,
    entryPoint: resolve(
      workspaceRoot,
      "packages",
      "host-watcher",
      "src",
      "parcel-subprocess",
      "parcel-child-entry.ts",
    ),
    label: "parcel watcher child",
    outfile: resolve(packageRoot, "dist", "bb-parcel-watcher-child.mjs"),
  },
];
