import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import {
  enrolledInstallerScript,
  manualEnrollmentCommand,
} from "./manual-enrollment-command.js";
import type { EnrollmentBootstrap } from "@get-bb/plugin-sdk";

const bootstrap: EnrollmentBootstrap = {
  version: 2,
  hostId: "host_test",
  credential: "short-lived-code",
  serverUrl: "https://test.getbb.app",
  expiresAt: Date.now() + 60_000,
  headers: { "x-access": "private'$value" },
};

it("keeps the copy command to one line without bootstrap data or provider credentials", () => {
  const command = manualEnrollmentCommand(bootstrap);
  expect(command).toBe(
    "curl -fsSL -H 'X-BB-Enrollment: short-lived-code' 'https://test.getbb.app/install.sh' | sh",
  );
  expect(command).not.toContain("private");
  expect(command).not.toContain("host_test");
});

it("passes the exact bootstrap and arguments to the installer without shell expansion", () => {
  const script = enrolledInstallerScript(
    'printf "%s\\n%s\\n%s" "$1" "$2" "$BB_ENROLLMENT"',
    bootstrap,
  );
  const result = spawnSync("sh", ["-c", script], { encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    `--bootstrap-env\nBB_ENROLLMENT\n${JSON.stringify(bootstrap)}`,
  );
});
