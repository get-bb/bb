import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildToParentMessage, ParentToChildMessage } from "./messages.js";
import type { ChildChannel } from "./parcel-watcher-proxy.js";

// Resolve the watcher child entry relative to this module's runtime location.
// In the packaged app this file is bundled into the daemon bundle, so the
// emitted child bundle (bb-parcel-watcher-child.mjs, see bundle-manifest.mjs)
// sits beside it in dist/. In dev this file runs from source, so the child is
// its `.ts` sibling — forked children inherit `--import tsx` via execArgv, so a
// `.ts` entry runs without extra wiring.
function resolveChildEntry(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    "bb-parcel-watcher-child.mjs", // packaged: sibling of the daemon bundle
    "parcel-child-entry.js", // built (unbundled tsc output)
    "parcel-child-entry.ts", // dev source
  ];
  for (const candidate of candidates) {
    const candidatePath = join(moduleDir, candidate);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }
  throw new Error(
    `Watcher child entry not found in ${moduleDir} (looked for ${candidates.join(", ")})`,
  );
}

export function createForkChannel(): ChildChannel {
  const child = fork(resolveChildEntry(), [], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  return {
    send(message: ParentToChildMessage) {
      if (child.connected) {
        child.send(message);
      }
    },
    onMessage(listener) {
      child.on("message", (message) => {
        listener(message as ChildToParentMessage);
      });
    },
    onExit(listener) {
      child.on("exit", () => listener());
    },
    kill() {
      child.kill("SIGKILL");
    },
  };
}
