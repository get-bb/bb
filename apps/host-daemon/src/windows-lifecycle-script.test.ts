import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_ENV_SETUP_SCRIPT_NAME,
  DEFAULT_ENV_TEARDOWN_SCRIPT_NAME,
} from "@bb/domain";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildLifecycleScriptCommand,
  runSetupScript,
  runTeardownScript,
} from "./environment-lifecycle-script.js";

const directories: string[] = [];

async function workspace(
  kind: "setup" | "teardown",
  script: string,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "bb-core-hooks-"));
  directories.push(directory);
  await writeFile(join(directory, `.bb-env-${kind}.sh`), script);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("native Windows environment lifecycle hooks", () => {
  it("builds a PowerShell command for Windows lifecycle scripts", () => {
    expect(
      buildLifecycleScriptCommand({
        kind: "setup",
        scriptName: ".bb-env-setup.ps1",
        platform: "win32",
        scriptPath: "C:\\repo\\.bb-env-setup.ps1",
      }),
    ).toMatchObject({
      command: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "C:\\repo\\.bb-env-setup.ps1",
      ],
      text: "powershell.exe -NoProfile -ExecutionPolicy Bypass -File .bb-env-setup.ps1",
    });
  });

  it("warns when only the POSIX setup hook exists on Windows", async () => {
    const workspacePath = await workspace("setup", "echo ignored\n");
    const output: string[] = [];
    const result = await runSetupScript({
      workspacePath,
      timeoutMs: 900000,
      platform: "win32",
      onProgress: (entry) => output.push(`${entry.type}:${entry.text}`),
    });
    expect(result).toEqual({ ran: false });
    expect(output).toContain(
      `output:${DEFAULT_ENV_SETUP_SCRIPT_NAME} is ignored on Windows; use .bb-env-setup.ps1 instead`,
    );
  });

  it("warns when only the POSIX teardown hook exists on Windows", async () => {
    const workspacePath = await workspace("teardown", "echo ignored\n");
    const output: string[] = [];
    const result = await runTeardownScript({
      workspacePath,
      timeoutMs: 900000,
      platform: "win32",
      onProgress: (entry) => output.push(`${entry.type}:${entry.text}`),
    });
    expect(result).toEqual({ ran: false });
    expect(output).toContain(
      `output:${DEFAULT_ENV_TEARDOWN_SCRIPT_NAME} is ignored on Windows; use .bb-env-teardown.ps1 instead`,
    );
  });
});
