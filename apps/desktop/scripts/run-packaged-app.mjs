import { join } from "node:path";
import { spawn } from "node:child_process";
import { forwardSignalsAndMirrorExit } from "./child-process-helpers.mjs";
import {
  createDesktopReleaseConfig,
  resolveDesktopReleaseChannel,
} from "./desktop-release-channel.mjs";
import { createPackagedAppLaunchArguments } from "./packaged-app-launch.mjs";
import { resolvePackagedAppBinary } from "./packaged-app-paths.mjs";

const packageRoot = process.cwd();
const releaseDir = join(packageRoot, "release");
const releaseConfig = createDesktopReleaseConfig(
  resolveDesktopReleaseChannel(process.env),
);

function createElectronAppEnv(env) {
  const childEnv = {
    ...env,
    BB_DESKTOP_OPEN_DEVTOOLS: env.BB_DESKTOP_OPEN_DEVTOOLS ?? "1",
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  return childEnv;
}

function createLaunchArguments(env) {
  const userDataDir = env.BB_DESKTOP_USER_DATA_DIR?.trim();
  if (userDataDir === undefined || userDataDir.length === 0) {
    return [];
  }
  return createPackagedAppLaunchArguments({
    platform: process.platform,
    userDataDir,
  });
}

const child = spawn(
  await resolvePackagedAppBinary({
    executableName: releaseConfig.linuxExecutableName,
    platform: process.platform,
    productName: releaseConfig.applicationName,
    releaseDir,
  }),
  createLaunchArguments(process.env),
  {
    env: createElectronAppEnv(process.env),
    stdio: "inherit",
  },
);

await forwardSignalsAndMirrorExit(child);
