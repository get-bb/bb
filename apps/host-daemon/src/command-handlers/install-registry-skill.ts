import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import type { CommandOf } from "../command-dispatch-support.js";
import { ExpectedCommandDispatchError } from "../command-dispatch-support.js";
import {
  copyInjectedSkillSource,
  ensureDataDirSkillsRootPath,
} from "../injected-skills.js";

const SKILL_FILE_NAME = "SKILL.md";
const SKILLS_INSTALL_TIMEOUT_MS = 120_000;
const MAX_INSTALL_OUTPUT_BYTES = 1_000_000;
export const REGISTRY_SKILLS_CLI_VERSION = "1.5.19";

export interface RegistrySkillsCliResult {
  ok: boolean;
  stderr: string;
  stdout: string;
}

export type RunRegistrySkillsCli = (args: {
  cwd: string;
  packageRef: string;
  skillId: string;
}) => Promise<RegistrySkillsCliResult>;

function appendBounded(current: string, chunk: unknown): string {
  if (current.length >= MAX_INSTALL_OUTPUT_BYTES) return current;
  return `${current}${String(chunk)}`.slice(0, MAX_INSTALL_OUTPUT_BYTES);
}

export function buildRegistrySkillsCliInvocation(args: {
  cwd: string;
  packageRef: string;
  platform?: NodeJS.Platform;
  processEnv?: NodeJS.ProcessEnv;
  skillId: string;
}): {
  command: string;
  args: string[];
  options: { cwd: string; env: NodeJS.ProcessEnv };
} {
  const platform = args.platform ?? process.platform;
  const processEnv = args.processEnv ?? process.env;
  const allowedKeys =
    platform === "win32"
      ? [
          "PATH",
          "Path",
          "PATHEXT",
          "SYSTEMROOT",
          "SystemRoot",
          "COMSPEC",
          "ComSpec",
          "TEMP",
          "TMP",
          "USERPROFILE",
          "APPDATA",
          "LOCALAPPDATA",
        ]
      : ["PATH", "HOME", "TMPDIR"];
  const env: NodeJS.ProcessEnv = { DISABLE_TELEMETRY: "1" };
  for (const key of allowedKeys) {
    const value = processEnv[key];
    if (value !== undefined) env[key] = value;
  }
  return {
    command: platform === "win32" ? "npx.cmd" : "npx",
    args: [
      "-y",
      `skills@${REGISTRY_SKILLS_CLI_VERSION}`,
      "add",
      args.packageRef,
      "--agent",
      "universal",
      "--skill",
      args.skillId,
      "--copy",
      "--yes",
    ],
    options: { cwd: args.cwd, env },
  };
}

function runRegistrySkillsCli(args: {
  cwd: string;
  packageRef: string;
  skillId: string;
}): Promise<RegistrySkillsCliResult> {
  const invocation = buildRegistrySkillsCliInvocation(args);
  return new Promise((resolve) => {
    const child = spawn(
      invocation.command,
      invocation.args,
      invocation.options,
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, SKILLS_INSTALL_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        stdout,
        stderr: stderr.trim().length > 0 ? stderr : error.message,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: !timedOut && code === 0,
        stdout,
        stderr: timedOut ? "Skill install timed out" : stderr,
      });
    });
  });
}

function errorMessage(result: RegistrySkillsCliResult): string {
  const detail = result.stderr.trim() || result.stdout.trim();
  return detail.length > 0 ? detail : "Unable to download the skill package";
}

async function readSkillDescription(
  skillFilePath: string,
  expectedName: string,
): Promise<string> {
  const content = await fs.readFile(skillFilePath, "utf8").catch(() => null);
  if (content === null) {
    throw new ExpectedCommandDispatchError(
      "registry_skill_invalid",
      `Downloaded skill is missing ${SKILL_FILE_NAME}`,
    );
  }
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---\n") && !trimmed.startsWith("---\r\n")) {
    throw new ExpectedCommandDispatchError(
      "registry_skill_invalid",
      `Downloaded ${SKILL_FILE_NAME} has invalid frontmatter`,
    );
  }
  let data: Record<string, unknown>;
  try {
    data = matter(content).data;
  } catch {
    throw new ExpectedCommandDispatchError(
      "registry_skill_invalid",
      `Downloaded ${SKILL_FILE_NAME} has invalid frontmatter`,
    );
  }
  if (data.name !== expectedName) {
    throw new ExpectedCommandDispatchError(
      "registry_skill_invalid",
      "Downloaded skill name does not match the registry skill",
    );
  }
  if (
    typeof data.description !== "string" ||
    data.description.trim().length === 0 ||
    data.description.length > 1_024
  ) {
    throw new ExpectedCommandDispatchError(
      "registry_skill_invalid",
      "Downloaded skill description is invalid",
    );
  }
  return data.description.trim();
}

function isFsErrorWithCode(error: unknown, codes: readonly string[]): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    codes.includes(error.code)
  );
}

/**
 * Download a registry skill into an isolated universal-agent root, validate and
 * bound its complete tree, then atomically adopt it as one manageable bb-user
 * skill. Existing user skills are never overwritten.
 */
export async function installHostRegistrySkill(
  command: CommandOf<"host.install_registry_skill">,
  options: { dataDir: string },
  dependencies: { runSkillsCli?: RunRegistrySkillsCli } = {},
): Promise<HostDaemonOnlineRpcResult<"host.install_registry_skill">> {
  const runSkillsCli = dependencies.runSkillsCli ?? runRegistrySkillsCli;
  const extractionRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "bb-registry-skill-"),
  );
  const skillsRootPath = await ensureDataDirSkillsRootPath(options.dataDir);
  const finalSkillPath = path.join(skillsRootPath, command.skillId);
  const temporarySkillPath = path.join(
    skillsRootPath,
    `.tmp-import-${command.skillId}-${randomUUID()}`,
  );

  try {
    if ((await fs.lstat(finalSkillPath).catch(() => null)) !== null) {
      throw new ExpectedCommandDispatchError(
        "skill_already_installed",
        `Skill "${command.skillId}" is already installed in bb`,
      );
    }

    const result = await runSkillsCli({
      cwd: extractionRoot,
      packageRef: command.packageRef,
      skillId: command.skillId,
    });
    if (!result.ok) {
      throw new ExpectedCommandDispatchError(
        "registry_install_failed",
        errorMessage(result),
      );
    }

    const extractedSkillPath = path.join(
      extractionRoot,
      ".agents",
      "skills",
      command.skillId,
    );
    const skillFilePath = path.join(extractedSkillPath, SKILL_FILE_NAME);
    await readSkillDescription(skillFilePath, command.skillId);

    try {
      await copyInjectedSkillSource({
        destinationPath: temporarySkillPath,
        name: command.skillId,
        sourceRootPath: extractedSkillPath,
        skillFilePath,
      });
    } catch (error) {
      throw new ExpectedCommandDispatchError(
        "registry_skill_invalid",
        error instanceof Error ? error.message : "Downloaded skill is invalid",
      );
    }
    try {
      await fs.rename(temporarySkillPath, finalSkillPath);
    } catch (error) {
      if (isFsErrorWithCode(error, ["EEXIST", "ENOTEMPTY"])) {
        throw new ExpectedCommandDispatchError(
          "skill_already_installed",
          `Skill "${command.skillId}" is already installed in bb`,
        );
      }
      throw error;
    }
    return { filePath: path.join(finalSkillPath, SKILL_FILE_NAME) };
  } finally {
    await Promise.all([
      fs.rm(extractionRoot, { recursive: true, force: true }),
      fs.rm(temporarySkillPath, { recursive: true, force: true }),
    ]);
  }
}
