import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PI_BRIDGE_ARGS_ENV, PI_BRIDGE_COMMAND_ENV } from "./rpc-child.js";
import {
  type FakePiBridgeHarness,
  fakePiPath,
  startFakePiBridge,
} from "./test-support.js";

let harness: FakePiBridgeHarness;
let requestId = 0;

function nextRequestId(): number {
  requestId += 1;
  return requestId;
}

beforeEach(async () => {
  harness = await startFakePiBridge({
    prefix: "bb-pi-install-gate-",
    initialize: true,
  });
});

afterEach(async () => {
  await harness.teardown();
});

it("reports ready with the installed version after the get_state probe", async () => {
  const response = await harness.request(nextRequestId(), "provider/health", {
    providerId: "pi",
    cwd: harness.workspaceDir,
  });
  expect(response.result).toMatchObject({
    supported: true,
    health: {
      status: "ready",
      installedVersion: "0.84.0",
      minimumSupportedVersion: "0.84.0",
      canInstall: true,
      canUpdate: true,
      loginCommand: "pi",
    },
  });
}, 30_000);

it("refuses a pi older than the supported minimum before spawning it", async () => {
  vi.stubEnv("FAKE_PI_VERSION", "0.83.2");
  const health = await harness.request(nextRequestId(), "provider/health", {
    providerId: "pi",
    cwd: harness.workspaceDir,
  });
  expect(health.result).toMatchObject({
    health: { status: "unsupported_version", installedVersion: "0.83.2" },
  });
  const models = await harness.request(nextRequestId(), "model/list", {
    cwd: harness.workspaceDir,
  });
  expect(models.error).toMatchObject({
    message: expect.stringContaining(
      "0.83.2 is older than the supported minimum 0.84.0",
    ),
  });
}, 30_000);

it("reports not_installed when the launch command is missing", async () => {
  vi.stubEnv(PI_BRIDGE_COMMAND_ENV, join(harness.workspaceDir, "no-such-pi"));
  vi.stubEnv(PI_BRIDGE_ARGS_ENV, "[]");
  const health = await harness.request(nextRequestId(), "provider/health", {
    providerId: "pi",
    cwd: harness.workspaceDir,
  });
  expect(health.result).toMatchObject({
    health: { status: "not_installed", canInstall: true, canUpdate: false },
  });
  const models = await harness.request(nextRequestId(), "model/list", {
    cwd: harness.workspaceDir,
  });
  expect(models.error).toMatchObject({
    message: expect.stringContaining("Could not find the pi CLI"),
  });
});

const PI_PACKAGE = "@earendil-works/pi-coding-agent";

async function stubDetectedPackageManager(
  manager: "npm" | "bun" | "mise",
): Promise<void> {
  const binDir = join(harness.workspaceDir, "tools", "bin");
  const miseDataDir = join(harness.workspaceDir, "tools", "mise");
  await mkdir(binDir, { recursive: true });
  const miseEntries =
    manager === "mise"
      ? [
          {
            version: "0.84.0",
            requested_version: "latest",
            install_path: join(miseDataDir, "installs", "npm-pi", "0.84.0"),
            installed: true,
            active: true,
          },
        ]
      : [];
  await writeFile(
    join(binDir, "mise"),
    `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(miseEntries)}'\n`,
    { mode: 0o755 },
  );
  if (manager === "bun") {
    await writeFile(
      join(binDir, "bun"),
      `#!/bin/sh\nprintf '%s\\n' '${dirname(process.execPath)}'\n`,
      { mode: 0o755 },
    );
  }
  vi.stubEnv("PATH", binDir);
  vi.stubEnv("MISE_DATA_DIR", miseDataDir);
}

it.each([
  { manager: "npm", command: `npm install -g ${PI_PACKAGE}@latest` },
  { manager: "bun", command: `bun add -g ${PI_PACKAGE}@latest` },
  { manager: "mise", command: `mise use -g -y npm:${PI_PACKAGE}@latest` },
] as const)(
  "fails closed when pi cannot report its version, with $manager install guidance",
  async ({ manager, command }) => {
    await stubDetectedPackageManager(manager);
    vi.stubEnv("FAKE_PI_VERSION", "crash");
    const health = await harness.request(nextRequestId(), "provider/health", {
      providerId: "pi",
      cwd: harness.workspaceDir,
    });
    expect(health.result).toMatchObject({
      health: {
        status: "unknown",
        installedVersion: null,
        statusMessage: expect.stringMatching(
          new RegExp(
            `^Could not determine the pi version: \`.*--version\` exited with 1\\. Install ${PI_PACKAGE} 0\\.84\\.0 or newer: ${command.replace(/[.+]/gu, "\\$&")}$`,
            "u",
          ),
        ),
      },
    });
    const models = await harness.request(nextRequestId(), "model/list", {
      cwd: harness.workspaceDir,
    });
    expect(models.error).toMatchObject({
      message: expect.stringContaining("Could not determine the pi version"),
    });
  },
  30_000,
);

it("memoizes the install gate per launch path across health polls", async () => {
  const processLog = join(harness.workspaceDir, "process.log");
  vi.stubEnv("FAKE_PI_PROCESS_LOG", processLog);
  await harness.request(nextRequestId(), "provider/health", {
    providerId: "pi",
    cwd: harness.workspaceDir,
  });
  await harness.request(nextRequestId(), "model/list", {
    cwd: harness.workspaceDir,
  });
  await harness.request(nextRequestId(), "provider/health", {
    providerId: "pi",
    cwd: harness.workspaceDir,
  });
  const versionSpawns = readFileSync(processLog, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("version:"));
  expect(versionSpawns).toHaveLength(1);
  vi.stubEnv(
    PI_BRIDGE_ARGS_ENV,
    JSON.stringify([fakePiPath, "--other-launch"]),
  );
  await harness.request(nextRequestId(), "provider/health", {
    providerId: "pi",
    cwd: harness.workspaceDir,
  });
  expect(
    readFileSync(processLog, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("version:")),
  ).toHaveLength(2);
}, 30_000);
