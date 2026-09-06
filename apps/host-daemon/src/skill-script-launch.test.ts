import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSkillScriptInvocation } from "./skill-script-launch.js";

const GIT_SH_EXE = "C:\\Program Files\\Git\\bin\\sh.exe";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "bb-skill-launch-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("resolveSkillScriptInvocation on POSIX", () => {
  for (const platform of ["linux", "darwin"] as const) {
    it(`passes ${platform} scripts through untouched`, () => {
      for (const scriptPath of [
        "/skills/demo/scripts/run.sh",
        "/skills/demo/scripts/run.cmd",
        "/skills/demo/scripts/run.ps1",
        "/skills/demo/run",
      ]) {
        expect(
          resolveSkillScriptInvocation(scriptPath, { platform }),
        ).toEqual({
          command: scriptPath,
          args: [],
          text: scriptPath,
        });
      }
    });
  }

  it("forwards script args on POSIX", () => {
    expect(
      resolveSkillScriptInvocation("/skills/demo/run", {
        platform: "linux",
        scriptArgs: ["one", "two words"],
      }),
    ).toEqual({
      command: "/skills/demo/run",
      args: ["one", "two words"],
      text: "/skills/demo/run",
    });
  });
});

describe("resolveSkillScriptInvocation on win32", () => {
  it("routes batch files through cmd.exe", () => {
    for (const scriptPath of [
      "C:\\skills\\demo\\run.cmd",
      "C:\\skills\\demo\\run.bat",
      "C:\\skills\\demo\\RUN.CMD",
    ]) {
      expect(
        resolveSkillScriptInvocation(scriptPath, { platform: "win32" }),
      ).toEqual({
        command: "cmd.exe",
        args: ["/d", "/c", scriptPath],
        text: `cmd.exe /d /c ${path.win32.basename(scriptPath)}`,
      });
    }
  });

  it("routes PowerShell scripts through powershell.exe", () => {
    const scriptPath = "C:\\skills\\demo\\run.PS1";
    expect(
      resolveSkillScriptInvocation(scriptPath, { platform: "win32" }),
    ).toEqual({
      command: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
      ],
      text: "powershell.exe -File run.PS1",
    });
  });

  it("routes node scripts through the daemon node runtime", () => {
    for (const name of ["run.mjs", "run.cjs", "run.js"]) {
      const scriptPath = `C:\\skills\\demo\\${name}`;
      expect(
        resolveSkillScriptInvocation(scriptPath, { platform: "win32" }),
      ).toEqual({
        command: process.execPath,
        args: [scriptPath],
        text: `node ${name}`,
      });
    }
  });

  it("routes shell scripts through sh.exe when one is provided", () => {
    expect(
      resolveSkillScriptInvocation("C:\\skills\\demo\\run.sh", {
        platform: "win32",
        shExePath: GIT_SH_EXE,
      }),
    ).toEqual({
      command: GIT_SH_EXE,
      args: ["C:\\skills\\demo\\run.sh"],
      text: "sh.exe run.sh",
    });
  });

  it("forwards script args after the script path", () => {
    expect(
      resolveSkillScriptInvocation("C:\\skills\\demo\\run.ps1", {
        platform: "win32",
        scriptArgs: ["one", "two words"],
      }),
    ).toEqual({
      command: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "C:\\skills\\demo\\run.ps1",
        "one",
        "two words",
      ],
      text: "powershell.exe -File run.ps1",
    });
  });

  it("reads extensions with Windows path rules", () => {
    expect(
      resolveSkillScriptInvocation("C:\\dir.name\\run.cmd", {
        platform: "win32",
      }).command,
    ).toBe("cmd.exe");
    expect(() =>
      resolveSkillScriptInvocation("C:\\dir.name\\run", {
        platform: "win32",
      }),
    ).toThrow(/no Windows launch mapping/);
  });

  it("fails loudly for shell scripts without an sh.exe path", () => {
    expect(() =>
      resolveSkillScriptInvocation("C:\\skills\\demo\\run.sh", {
        platform: "win32",
      }),
    ).toThrow(/needs a POSIX shell on Windows/);
    expect(() =>
      resolveSkillScriptInvocation("C:\\skills\\demo\\run.sh", {
        platform: "win32",
        shExePath: null,
      }),
    ).toThrow(/needs a POSIX shell on Windows/);
  });

  it("fails loudly for extensionless and unknown scripts", () => {
    expect(() =>
      resolveSkillScriptInvocation("C:\\skills\\demo\\run", {
        platform: "win32",
      }),
    ).toThrow(/no Windows launch mapping/);
    expect(() =>
      resolveSkillScriptInvocation("C:\\skills\\demo\\run.py", {
        platform: "win32",
      }),
    ).toThrow(/no Windows launch mapping/);
  });
});

describe.runIf(process.platform === "win32")(
  "skill script launch on real Windows",
  () => {
    function runInvocation(
      scriptPath: string,
      options: { scriptArgs?: readonly string[]; shExePath?: string } = {},
    ): { status: number | null; stdout: string; stderr: string } {
      const invocation = resolveSkillScriptInvocation(scriptPath, {
        platform: "win32",
        ...options,
      });
      const result = spawnSync(invocation.command, invocation.args, {
        encoding: "utf8",
        timeout: 15_000,
      });
      if (result.error) {
        throw result.error;
      }
      return {
        status: result.status,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    }

    it("runs a staged .cmd through cmd.exe", async () => {
      const dir = await makeTempDir();
      const scriptPath = path.join(dir, "hello.cmd");
      await writeFile(scriptPath, "@echo off\r\necho CMD-OK\r\n");
      const result = runInvocation(scriptPath);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("CMD-OK");
    });

    it("runs a staged .ps1 through powershell.exe, including spaced args", async () => {
      const dir = await makeTempDir();
      const scriptPath = path.join(dir, "hello.ps1");
      await writeFile(
        scriptPath,
        'param($a)\nWrite-Output "PS1-GOT $a"\n',
      );
      const result = runInvocation(scriptPath, {
        scriptArgs: ["two words"],
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("PS1-GOT two words");
    });

    it("runs a staged .mjs through node, including spaced args", async () => {
      const dir = await makeTempDir();
      const scriptPath = path.join(dir, "hello.mjs");
      await writeFile(
        scriptPath,
        "console.log(`MJS-GOT ${process.argv[2]}`);\n",
      );
      const result = runInvocation(scriptPath, {
        scriptArgs: ["two words"],
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("MJS-GOT two words");
    });

    it.runIf(existsSync(GIT_SH_EXE))(
      "runs a staged .sh through Git sh.exe",
      async () => {
        const dir = await makeTempDir();
        const scriptPath = path.join(dir, "hello.sh");
        await writeFile(scriptPath, '#!/bin/sh\necho "SH-GOT $1"\n');
        const result = runInvocation(scriptPath, {
          scriptArgs: ["two words"],
          shExePath: GIT_SH_EXE,
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("SH-GOT two words");
      },
    );
  },
);
