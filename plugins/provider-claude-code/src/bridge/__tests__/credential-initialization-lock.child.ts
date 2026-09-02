import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { createClaudeCredentialInitializationCoordinator } from "../credential-initialization-lock.js";

const [lockRoot, homeDir, configDir, platform] = process.argv.slice(2);
if (
  lockRoot === undefined ||
  homeDir === undefined ||
  configDir === undefined ||
  platform === undefined
) {
  throw new Error(
    "Expected lock root, home directory, and Claude config directory",
  );
}

const coordinator = createClaudeCredentialInitializationCoordinator({
  lockRoot,
  platform: platform as NodeJS.Platform,
  retryIntervalMs: 25,
  staleMs: 500,
  updateMs: 100,
});

await coordinator.run(
  { HOME: homeDir, CLAUDE_CONFIG_DIR: configDir },
  async () => {
    process.send?.({ type: "entered" });
    await new Promise<void>((resolve) => {
      process.on("message", (message) => {
        if (message === "release") resolve();
      });
    });
    process.send?.({ type: "leaving" });
    await sleep(10);
  },
);
process.disconnect?.();
