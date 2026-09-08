import { hash } from "./model.js";

export const baseManifest = {
  version: "bb-modal-v1.0.1",
  platform: "linux/amd64",
  registry:
    "node:22.19.0-bookworm@sha256:afff6d8c97964a438d2e6a9c96509367e45d8bf93f790ad561a1eaea926303d9",
  node: "22.19.0",
  distribution: "Debian bookworm",
  packages: ["git", "curl", "ca-certificates", "build-essential", "python3"],
  npmPackages: {
    "@openai/codex": "0.153.4",
    "@anthropic-ai/claude-code": "2.1.263",
  },
  bbPackage: "server-host-artifact-with-recorded-sha256",
  builder: "modal@0.10.0",
  credentials: "none",
} as const;
export const baseCommands = [
  "RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates build-essential python3 && rm -rf /var/lib/apt/lists/*",
  `RUN npm install -g ${Object.entries(baseManifest.npmPackages)
    .map(([name, version]) => `${name}@${version}`)
    .join(" ")} && npm cache clean --force`,

  `RUN mkdir -p /opt/bb-project && printf '%s' '${Buffer.from(JSON.stringify(baseManifest)).toString("base64")}' | base64 -d > /opt/bb-project/base-manifest.json`,
];
export const baseDigest = hash(
  JSON.stringify({ manifest: baseManifest, commands: baseCommands }),
);
