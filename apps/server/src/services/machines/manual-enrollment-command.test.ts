import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { expect, it } from "vitest";
import {
  enrolledInstallerScript,
  enrolledWindowsInstallerScript,
  manualEnrollmentCommand,
  manualEnrollmentPowerShellCommand,
  windowsInstallerFailureScript,
} from "./manual-enrollment-command.js";
import type { EnrollmentBootstrap } from "./enrollments.js";

const bootstrap: EnrollmentBootstrap = {
  hostId: "host_test",
  credential: "short-lived-code",
  serverUrl: "https://test.getbb.app",
  expiresAt: Date.now() + 60_000,
  headers: { "x-access": "private'$value" },
};

it("passes the exact bootstrap and arguments to the installer without shell expansion", ({
  skip,
}) => {
  skip(
    process.platform === "win32",
    "the enrollment command is a POSIX sh pipeline",
  );
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

it("builds the transient curl command from the enrollment bootstrap", () => {
  expect(manualEnrollmentCommand(bootstrap)).toBe(
    "curl -sSL --fail-with-body -H 'X-BB-Enrollment: short-lived-code' 'https://test.getbb.app/install.sh' | sh",
  );
});

it("builds the transient PowerShell command from the enrollment bootstrap", () => {
  expect(manualEnrollmentPowerShellCommand(bootstrap)).toBe(
    "irm -Headers @{ 'X-BB-Enrollment' = 'short-lived-code' } 'https://test.getbb.app/install.ps1' | iex",
  );
  expect(
    manualEnrollmentPowerShellCommand({ ...bootstrap, credential: "it's" }),
  ).toContain("'X-BB-Enrollment' = 'it''s'");
});

it("wraps the Windows installer and its bootstrap in literal PowerShell strings", () => {
  const script = enrolledWindowsInstallerScript(
    "console.log('$env:USERNAME `n');\n",
    bootstrap,
  );
  const lines = script.split("\n");
  const start = lines.indexOf("[IO.File]::WriteAllText($bbInstaller, @'");
  expect(lines[start + 1]).toBe("console.log('$env:USERNAME `n');");
  expect(lines[start + 2]).toBe("'@, (New-Object Text.UTF8Encoding $false))");
  expect(lines[start + 3]).toBe(
    `$env:BB_ENROLLMENT = '${JSON.stringify(bootstrap).replaceAll("'", "''")}'`,
  );
  expect(script).toContain(
    "& $bbNode.Source $bbInstaller --bootstrap-env BB_ENROLLMENT",
  );
  expect(script).toContain("Remove-Item Env:BB_ENROLLMENT");
});

it("refuses a Windows installer that would end the PowerShell here-string early", () => {
  expect(() =>
    enrolledWindowsInstallerScript("first\n'@ + injected\n", bootstrap),
  ).toThrow("cannot contain a line that starts with '@");
});

it("reports a Windows enrollment failure as a PowerShell error", () => {
  expect(windowsInstallerFailureScript("can't enroll")).toBe(
    "throw 'can''t enroll'\n",
  );
});

it("prints the server's enrollment error and stops before running the installer", ({
  skip,
}) => {
  skip(
    process.platform === "win32",
    "the enrollment command is a POSIX sh pipeline",
  );
  const directory = mkdtempSync(join(tmpdir(), "bb-enrollment-command-"));
  try {
    const curl = join(directory, "curl");
    writeFileSync(
      curl,
      "#!/bin/sh\nprintf '%s\\n' \"echo 'This enrollment command has already been used.' >&2\" 'exit 1'\nexit 22\n",
    );
    chmodSync(curl, 0o755);
    const result = spawnSync("sh", ["-c", manualEnrollmentCommand(bootstrap)], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: [directory, process.env.PATH].join(delimiter),
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("already been used");
    expect(result.stderr).not.toContain("Syntax error");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
