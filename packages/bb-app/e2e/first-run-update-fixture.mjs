import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
const REGISTRIES = {
  "claude-code": "https://registry.npmjs.org/@anthropic-ai%2fclaude-code",
  codex: "https://registry.npmjs.org/@openai%2fcodex",
};

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

async function execute(executable, args, env, cwd, operation) {
  try {
    return await execFileAsync(executable, args, {
      env,
      cwd,
      timeout: 300_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    const detail =
      typeof error.code === "number"
        ? `exit ${error.code}`
        : error.killed
          ? "timed out"
          : "could not execute";
    throw new Error(`${operation}: ${detail}`);
  }
}

async function installedVersion(executable, env, cwd) {
  const { stdout } = await execute(
    executable,
    ["--version"],
    env,
    cwd,
    "Read installed agent version",
  );
  const version = stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0];
  if (!version) throw new Error("Agent did not report a semantic version");
  return version;
}

async function precedingVersion(registry, currentVersion, provider) {
  const response = await fetch(registry, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Agent release registry returned HTTP ${response.status}`);
  }
  const metadata = await response.json();
  if (
    !metadata ||
    typeof metadata !== "object" ||
    !metadata.versions ||
    typeof metadata.versions !== "object" ||
    Array.isArray(metadata.versions)
  ) {
    throw new Error("Agent release registry returned invalid metadata");
  }
  const ceilings = [currentVersion];
  if (provider === "claude-code") {
    for (const tag of ["stable", "latest"]) {
      const version = metadata["dist-tags"]?.[tag];
      if (typeof version === "string" && STABLE_VERSION.test(version)) ceilings.push(version);
    }
  }
  const versions = Object.keys(metadata.versions)
    .filter(
      (version) =>
        STABLE_VERSION.test(version) &&
        ceilings.every((ceiling) => compareVersions(version, ceiling) < 0),
    )
    .sort((left, right) => compareVersions(right, left));
  if (versions.length === 0) {
    throw new Error(`No published stable release predates ${currentVersion}`);
  }
  return versions[0];
}

async function prepareCodex(version, env, cwd) {
  const windows = process.platform === "win32";
  const extension = windows ? "ps1" : "sh";
  const response = await fetch(`https://chatgpt.com/codex/install.${extension}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Codex installer returned HTTP ${response.status}`);
  }
  const script = await response.text();
  if (
    !script.includes("CODEX_RELEASE") ||
    !script.includes("CODEX_NON_INTERACTIVE")
  ) {
    throw new Error("Codex installer no longer exposes the expected controls");
  }
  const directory = await mkdtemp(join(cwd, ".first-run-update-"));
  try {
    const path = join(directory, `install.${extension}`);
    await writeFile(path, script, "utf8");
    const systemRoot = env.SystemRoot ?? env.SYSTEMROOT;
    if (windows && !systemRoot) {
      throw new Error("Windows SystemRoot is required to invoke the installer");
    }
    const command = windows
      ? join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "/bin/sh";
    const args = windows
      ? [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path,
        ]
      : [path];
    await execute(
      command,
      args,
      { ...env, CODEX_RELEASE: version, CODEX_NON_INTERACTIVE: "1" },
      cwd,
      "Install earlier native Codex release",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function prepareUpdate({ provider, executable, env, cwd }) {
  const registry = REGISTRIES[provider];
  if (!registry) throw new Error("No native update fixture for this provider");
  const originalVersion = await installedVersion(executable, env, cwd);
  const version = await precedingVersion(registry, originalVersion, provider);
  if (provider === "claude-code") {
    await execute(
      executable,
      ["install", version],
      env,
      cwd,
      "Install earlier native Claude Code release",
    );
  } else {
    await prepareCodex(version, env, cwd);
  }
  const observedVersion = await installedVersion(executable, env, cwd);
  if (observedVersion !== version) {
    throw new Error(
      `Native update fixture expected ${version}, observed ${observedVersion}`,
    );
  }
  return {
    version,
    reason: `Installed real native ${version}, previously ${originalVersion}; release selected from ${registry}`,
  };
}
