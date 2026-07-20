import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isExpectedCommandDispatchError } from "../command-dispatch-support.js";
import {
  buildRegistrySkillsCliInvocation,
  installHostRegistrySkill,
  REGISTRY_SKILLS_CLI_VERSION,
  type RunRegistrySkillsCli,
} from "./install-registry-skill.js";

const temporaryRoots: string[] = [];

async function makeDataDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bb-registry-test-"));
  temporaryRoots.push(root);
  return path.join(root, "data");
}

async function writeExtractedSkill(args: {
  cwd: string;
  description?: string;
  frontmatterName?: string;
  skillId: string;
}): Promise<string> {
  const skillPath = path.join(args.cwd, ".agents", "skills", args.skillId);
  await fs.mkdir(path.join(skillPath, "scripts"), { recursive: true });
  await fs.writeFile(
    path.join(skillPath, "SKILL.md"),
    [
      "---",
      `name: ${args.frontmatterName ?? args.skillId}`,
      `description: ${args.description ?? "Review the current diff."}`,
      "---",
      "",
      "# Review",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(skillPath, "scripts", "review.sh"),
    "#!/bin/sh\n",
    "utf8",
  );
  return skillPath;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("installHostRegistrySkill", () => {
  it("runs a pinned installer with a minimal POSIX environment", () => {
    const invocation = buildRegistrySkillsCliInvocation({
      cwd: "/tmp/extract",
      packageRef: "owner/repo",
      skillId: "review",
      platform: "linux",
      processEnv: {
        PATH: "/usr/bin",
        HOME: "/home/user",
        TMPDIR: "/tmp",
        AWS_SECRET_ACCESS_KEY: "secret",
        GITHUB_TOKEN: "secret",
      },
    });

    expect(invocation).toEqual({
      command: "npx",
      args: [
        "-y",
        `skills@${REGISTRY_SKILLS_CLI_VERSION}`,
        "add",
        "owner/repo",
        "--agent",
        "universal",
        "--skill",
        "review",
        "--copy",
        "--yes",
      ],
      options: {
        cwd: "/tmp/extract",
        env: {
          DISABLE_TELEMETRY: "1",
          PATH: "/usr/bin",
          HOME: "/home/user",
          TMPDIR: "/tmp",
        },
      },
    });
    expect(invocation.args[1]).not.toContain("latest");
  });

  it("uses the Windows executable and preserves only launch-critical variables", () => {
    const invocation = buildRegistrySkillsCliInvocation({
      cwd: "C:\\extract",
      packageRef: "owner/repo",
      skillId: "review",
      platform: "win32",
      processEnv: {
        Path: "C:\\Windows\\System32",
        SystemRoot: "C:\\Windows",
        ComSpec: "C:\\Windows\\cmd.exe",
        USERPROFILE: "C:\\Users\\user",
        NPM_TOKEN: "secret",
      },
    });

    expect(invocation.command).toBe("npx.cmd");
    expect(invocation.options.env).toEqual({
      DISABLE_TELEMETRY: "1",
      Path: "C:\\Windows\\System32",
      SystemRoot: "C:\\Windows",
      ComSpec: "C:\\Windows\\cmd.exe",
      USERPROFILE: "C:\\Users\\user",
    });
  });

  it("atomically imports a complete package as one bb user skill", async () => {
    const dataDir = await makeDataDir();
    let extractionRoot = "";
    const runSkillsCli = vi.fn<RunRegistrySkillsCli>(async (args) => {
      extractionRoot = args.cwd;
      await writeExtractedSkill({ cwd: args.cwd, skillId: args.skillId });
      return { ok: true, stdout: "installed", stderr: "" };
    });

    const result = await installHostRegistrySkill(
      {
        type: "host.install_registry_skill",
        packageRef: "owner/repo",
        skillId: "review",
      },
      { dataDir },
      { runSkillsCli },
    );

    expect(runSkillsCli).toHaveBeenCalledWith({
      cwd: expect.any(String),
      packageRef: "owner/repo",
      skillId: "review",
    });
    expect(result.filePath).toBe(
      path.join(dataDir, "skills", "review", "SKILL.md"),
    );
    expect(
      await fs.readFile(
        path.join(dataDir, "skills", "review", "scripts", "review.sh"),
        "utf8",
      ),
    ).toBe("#!/bin/sh\n");
    await expect(fs.access(extractionRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("never overwrites an existing bb user skill", async () => {
    const dataDir = await makeDataDir();
    await fs.mkdir(path.join(dataDir, "skills", "review"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(dataDir, "skills", "review", "SKILL.md"),
      "existing",
      "utf8",
    );
    const runSkillsCli = vi.fn<RunRegistrySkillsCli>();

    const error = await installHostRegistrySkill(
      {
        type: "host.install_registry_skill",
        packageRef: "owner/repo",
        skillId: "review",
      },
      { dataDir },
      { runSkillsCli },
    ).catch((caught: unknown) => caught);

    expect(isExpectedCommandDispatchError(error)).toBe(true);
    expect(error).toMatchObject({ code: "skill_already_installed" });
    expect(runSkillsCli).not.toHaveBeenCalled();
    expect(
      await fs.readFile(
        path.join(dataDir, "skills", "review", "SKILL.md"),
        "utf8",
      ),
    ).toBe("existing");
  });

  it("rejects a package whose frontmatter name does not match", async () => {
    const dataDir = await makeDataDir();
    const runSkillsCli = vi.fn<RunRegistrySkillsCli>(async (args) => {
      await writeExtractedSkill({
        cwd: args.cwd,
        skillId: args.skillId,
        frontmatterName: "another-skill",
      });
      return { ok: true, stdout: "installed", stderr: "" };
    });

    const error = await installHostRegistrySkill(
      {
        type: "host.install_registry_skill",
        packageRef: "owner/repo",
        skillId: "review",
      },
      { dataDir },
      { runSkillsCli },
    ).catch((caught: unknown) => caught);

    expect(isExpectedCommandDispatchError(error)).toBe(true);
    expect(error).toMatchObject({ code: "registry_skill_invalid" });
    await expect(
      fs.access(path.join(dataDir, "skills", "review")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects symlinks in downloaded skill bundles", async () => {
    const dataDir = await makeDataDir();
    const runSkillsCli = vi.fn<RunRegistrySkillsCli>(async (args) => {
      const skillPath = await writeExtractedSkill({
        cwd: args.cwd,
        skillId: args.skillId,
      });
      await fs.symlink(
        path.join(skillPath, "SKILL.md"),
        path.join(skillPath, "linked.md"),
      );
      return { ok: true, stdout: "installed", stderr: "" };
    });

    const error = await installHostRegistrySkill(
      {
        type: "host.install_registry_skill",
        packageRef: "owner/repo",
        skillId: "review",
      },
      { dataDir },
      { runSkillsCli },
    ).catch((caught: unknown) => caught);

    expect(isExpectedCommandDispatchError(error)).toBe(true);
    expect(error).toMatchObject({ code: "registry_skill_invalid" });
    await expect(
      fs.access(path.join(dataDir, "skills", "review")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
