import { join } from "node:path";
import { spawn } from "node:child_process";
import { forwardSignalsAndMirrorExit } from "./child-process-helpers.mjs";
import {
  createDesktopReleaseConfig,
  resolveDesktopReleaseChannel,
} from "./desktop-release-channel.mjs";
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

const child = spawn(
  await resolvePackagedAppBinary({
    executableName: releaseConfig.linuxExecutableName,
    platform: process.platform,
    productName: releaseConfig.applicationName,
    releaseDir,
  }),
  [],
  {
    env: createElectronAppEnv(process.env),
    stdio: "inherit",
  },
);

await forwardSignalsAndMirrorExit(child);
