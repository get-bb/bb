import type { TestAppHarness } from "./test-app.js";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "./commands.js";

export async function answerMachineReadiness(harness: TestAppHarness) {
  const cli = await waitForQueuedCommand(
    harness,
    ({ command }) => command.type === "provider.installation.status",
  );
  await reportQueuedCommandSuccess(harness, cli, {
    executableName: "codex",
    executablePath: "/bin/codex",
    installed: true,
    installSource: "npmGlobal",
    currentVersion: "1.0.0",
    latestVersion: "1.0.0",
    minimumSupportedVersion: "1.0.0",
    npmPackageName: "codex",
    npmGlobalPackageVersion: "1.0.0",
    installAction: null,
    needsUpdate: false,
    versionUnsupported: false,
  });
  const auth = await waitForQueuedCommand(
    harness,
    ({ command }) => command.type === "provider.health",
  );
  await reportQueuedCommandSuccess(harness, auth, {
    supported: true,
    health: {
      status: "ready",
      statusMessage: null,
      accountEmail: null,
      planLabel: null,
      installedVersion: "1.0.0",
      minimumSupportedVersion: "1.0.0",
      canInstall: false,
      canUpdate: false,
      loginCommand: null,
    },
  });
}
