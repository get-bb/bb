import { execFile, spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  createDesktopReleaseConfig,
  resolveDesktopReleaseChannel,
} from "./desktop-release-channel.mjs";
import { createPackagedAppLaunchArguments } from "./packaged-app-launch.mjs";
import { resolvePackagedAppBinary } from "./packaged-app-paths.mjs";

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopPackageRoot = resolve(scriptDirectory, "..");
const releaseDir = join(desktopPackageRoot, "release");
const startupTimeoutMs = 60_000;
const settleMs = 10_000;
const exitTimeoutMs = 15_000;
const pollIntervalMs = 250;

function sleep(delayMs) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, delayMs);
  });
}

function parseEvidenceDir(argv) {
  const flagIndex = argv.indexOf("--evidence-dir");
  if (flagIndex !== -1 && flagIndex + 1 < argv.length) {
    return argv[flagIndex + 1];
  }
  return "qa-evidence";
}

function parseTasklistCsv(stdout) {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith('"'))
    .map((line) => {
      const cells = line.split('","').map((cell) => cell.replace(/^"|"$/g, ""));
      return { image: cells[0] ?? "", pid: Number(cells[1] ?? NaN) };
    })
    .filter((row) => row.image.length > 0 && Number.isInteger(row.pid));
}

function isInterestingImage(imageName, appImageName) {
  const lower = imageName.toLowerCase();
  return (
    lower === "node.exe" ||
    lower === "powershell.exe" ||
    lower === "pwsh.exe" ||
    lower === "cmd.exe" ||
    lower === "conhost.exe" ||
    lower === appImageName.toLowerCase() ||
    lower.startsWith("electron")
  );
}

async function snapshotTasklist() {
  const { stdout } = await execFileAsync("tasklist.exe", ["/FO", "CSV", "/NH"]);
  return { raw: stdout, rows: parseTasklistCsv(stdout) };
}

async function waitForImage(imageName, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const lower = imageName.toLowerCase();
  while (Date.now() <= deadline) {
    const snapshot = await snapshotTasklist();
    const match = snapshot.rows.find(
      (row) => row.image.toLowerCase() === lower,
    );
    if (match) {
      return match;
    }
    await sleep(pollIntervalMs);
  }
  return null;
}

async function waitForPidGone(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const snapshot = await snapshotTasklist();
    if (!snapshot.rows.some((row) => row.pid === pid)) {
      return true;
    }
    await sleep(pollIntervalMs);
  }
  return false;
}

async function smokeWindowsProcesses() {
  if (process.platform !== "win32") {
    throw new Error(
      `The Windows process-hygiene smoke requires win32, got ${process.platform}.`,
    );
  }
  const evidenceDir = resolve(process.cwd(), parseEvidenceDir(process.argv));
  await mkdir(evidenceDir, { recursive: true });

  const releaseConfig = createDesktopReleaseConfig(
    resolveDesktopReleaseChannel(process.env),
  );
  const appBinary = await resolvePackagedAppBinary({
    executableName: releaseConfig.linuxExecutableName,
    platform: process.platform,
    productName: releaseConfig.windowsApplicationName,
    releaseDir,
  });
  const appImageName = basename(appBinary).toLowerCase();
  console.log(`Process hygiene smoke: binary ${appBinary}`);

  const before = await snapshotTasklist();
  await writeFile(join(evidenceDir, "tasklist-before.csv"), before.raw, "utf8");
  console.log(
    `Process hygiene smoke: ${String(before.rows.length)} processes before launch.`,
  );

  const smokeRoot = await mkdtemp(join(tmpdir(), "bb-win-process-smoke-"));
  const dataDir = join(smokeRoot, "data");
  const userDataDir = join(smokeRoot, "user-data");
  const childEnv = {
    ...process.env,
    BB_DATA_DIR: dataDir,
    BB_DESKTOP_ATTACH_WITHOUT_PROMPT: "1",
    BB_DESKTOP_OPEN_DEVTOOLS: "0",
  };
  delete childEnv.BB_DESKTOP_APP_URL;
  delete childEnv.BB_DESKTOP_NODE_EXEC_PATH;
  delete childEnv.ELECTRON_RUN_AS_NODE;

  const failures = [];
  const child = spawn(
    appBinary,
    createPackagedAppLaunchArguments({
      platform: process.platform,
      userDataDir,
    }),
    { env: childEnv, stdio: "ignore" },
  );
  try {
    if (child.pid === undefined) {
      failures.push("Packaged app did not expose a PID.");
    } else {
      console.log(`Process hygiene smoke: app pid ${String(child.pid)}.`);
      const seen = await waitForImage(basename(appBinary), startupTimeoutMs);
      if (seen === null) {
        failures.push(
          `Packaged app image ${appImageName} never appeared in tasklist within ${String(startupTimeoutMs)}ms.`,
        );
      } else {
        await sleep(settleMs);
        if (child.exitCode !== null || child.signalCode !== null) {
          failures.push(
            `Packaged app exited during settle: code=${String(child.exitCode)} signal=${String(child.signalCode)}.`,
          );
        } else {
          spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
          });
          const gone = await waitForPidGone(child.pid, exitTimeoutMs);
          if (!gone) {
            failures.push(
              `App pid ${String(child.pid)} survived taskkill /T /F.`,
            );
          }
        }
      }
    }
  } finally {
    if (
      child.pid !== undefined &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
      await waitForPidGone(child.pid, exitTimeoutMs);
    }
  }

  await sleep(2_000);
  const after = await snapshotTasklist();
  await writeFile(join(evidenceDir, "tasklist-after.csv"), after.raw, "utf8");
  const beforePids = new Set(before.rows.map((row) => row.pid));
  const leaked = after.rows.filter(
    (row) =>
      !beforePids.has(row.pid) &&
      row.pid !== process.pid &&
      isInterestingImage(row.image, appImageName),
  );
  if (leaked.length > 0) {
    failures.push(
      `Leaked processes after app shutdown: ${leaked
        .map((row) => `${row.image}(${String(row.pid)})`)
        .join(", ")}.`,
    );
  }
  console.log(
    `Process hygiene smoke: ${String(after.rows.length)} processes after shutdown, ${String(leaked.length)} new interesting processes.`,
  );

  if (failures.length > 0) {
    for (const failure of failures) {
      console.log(`FAILED process-hygiene: ${failure}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("Process hygiene smoke passed: no leaked processes.");
}

await smokeWindowsProcesses().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : error;
  console.error(message);
  process.exitCode = 1;
});
