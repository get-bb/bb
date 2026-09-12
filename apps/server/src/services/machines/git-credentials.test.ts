import { mergeHostAndProviderEnvironment } from "../hosts/host-environment.js";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveGitCredentials, machineGitHealth } from "./git-credentials.js";

const exec = promisify(execFile);
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});

function gh(email: string | null = null) {
  return vi.fn(async (args: string[]) =>
    args[0] === "auth"
      ? "test-private-token\n"
      : JSON.stringify({ login: "octocat", id: 123, email }),
  );
}

async function gitEnv() {
  const home = await mkdtemp(join(tmpdir(), "bb-git-env-"));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const entries = await resolveGitCredentials(gh());
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
    GIT_TERMINAL_PROMPT: "0",
  };
  for (const entry of entries) {
    if (typeof entry.value !== "string") throw new Error("Unresolved entry");
    env[entry.name] = entry.value;
  }
  return { home, env };
}

function fill(
  env: NodeJS.ProcessEnv,
  input: string,
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["credential", "fill"], { env });
    let stdout = "";
    child.stdout.on("data", (value: Buffer) => {
      stdout += value.toString();
    });
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
    child.stdin.end(input);
  });
}

describe("machine Git environment", () => {
  it("lets agent-provider contributions override host credentials", async () => {
    const host = await resolveGitCredentials(gh());
    const provider = [
      {
        name: "GH_TOKEN",
        value: "provider-token",
        source: { plugin: "provider" },
        reason: "Override",
      },
    ];
    const merged = mergeHostAndProviderEnvironment(host, provider);
    expect(merged.filter((entry) => entry.name === "GH_TOKEN")).toEqual(
      provider,
    );
    expect(merged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "GIT_CONFIG_COUNT" }),
      ]),
    );
  });

  it("derives login identity and public or noreply email", async () => {
    for (const email of [null, "public@example.com"]) {
      const entries = await resolveGitCredentials(gh(email));
      const env = Object.fromEntries(
        entries.map((entry) => [entry.name, entry.value]),
      );
      expect(env.GIT_AUTHOR_NAME).toBe("octocat");
      expect(env.GIT_COMMITTER_NAME).toBe("octocat");
      expect(env.GIT_AUTHOR_EMAIL).toBe(
        email ?? "123+octocat@users.noreply.github.com",
      );
      expect(env.GIT_COMMITTER_EMAIL).toBe(env.GIT_AUTHOR_EMAIL);
      expect(
        JSON.stringify(entries.filter((entry) => entry.name !== "GH_TOKEN")),
      ).not.toContain("test-private-token");
    }
  });

  it("returns no credentials and safe health for gh failure or malformed identity", async () => {
    for (const run of [
      async () => {
        throw new Error("private-token-in-stderr");
      },
      async () => "invalid-json",
    ]) {
      expect(await resolveGitCredentials(run)).toEqual([]);
      expect(await machineGitHealth(run)).toEqual({
        status: "not configured",
        statusMessage: "gh is not logged in on the server",
      });
    }
  });

  it("expands GH_TOKEN when Git invokes the helper, and only for github.com HTTPS", async () => {
    const { env } = await gitEnv();
    env.GH_TOKEN = "rotated-token";
    const result = await fill(env, "protocol=https\nhost=github.com\n\n");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      "username=x-access-token\npassword=rotated-token\n",
    );
    for (const input of [
      "protocol=https\nhost=github.com.attacker.example\n\n",
      "protocol=http\nhost=github.com\n\n",
    ]) {
      const rejected = await fill(env, input);
      expect(rejected.code).not.toBe(0);
      expect(rejected.stdout).not.toContain("rotated-token");
    }
  });

  it("clones a local bare repo through a fake HTTPS helper that requests Git credentials", async () => {
    const { env, home } = await gitEnv();
    const source = join(home, "source");
    const bare = join(home, "private.git");
    const helpers = join(home, "helpers");
    await mkdir(helpers);
    await exec("git", ["init", source], { env });
    await writeFile(join(source, "gate.txt"), "private clone succeeded");
    await exec("git", ["add", "."], { cwd: source, env });
    await exec("git", ["commit", "-m", "seed"], { cwd: source, env });
    await exec("git", ["clone", "--bare", source, bare], { env });
    const helper = `#!/usr/bin/env python3
import os, subprocess, sys
assert sys.argv[2] == "https://github.com/octocat/private.git"
auth = subprocess.run(["git", "credential", "fill"], input="protocol=https\\nhost=github.com\\n\\n", text=True, capture_output=True, check=True).stdout
assert "username=x-access-token\\n" in auth
assert "password=" + os.environ["GH_TOKEN"] + "\\n" in auth
for line in sys.stdin:
    if line.strip() == "capabilities":
        print("connect\\n", flush=True)
    elif line.startswith("connect "):
        print("", flush=True)
        os.execlp("git", "git", "upload-pack", os.environ["FAKE_BARE"])
`;
    await writeFile(join(helpers, "git-remote-https"), helper, { mode: 0o755 });
    const target = join(home, "cloned");
    await exec("git", ["clone", "git@github.com:octocat/private.git", target], {
      env: { ...env, GIT_EXEC_PATH: helpers, FAKE_BARE: bare },
    });
    expect(await readFile(join(target, "gate.txt"), "utf8")).toBe(
      "private clone succeeded",
    );
  });

  it("rewrites both SSH forms without storing any Git configuration", async () => {
    const { env, home } = await gitEnv();
    await exec("git", ["init", home], { env });
    for (const remote of [
      "git@github.com:octocat/private.git",
      "ssh://git@github.com/octocat/private.git",
    ]) {
      const result = await exec("git", ["ls-remote", "--get-url", remote], {
        env,
        cwd: home,
      });
      expect(result.stdout.trim()).toBe(
        "https://github.com/octocat/private.git",
      );
    }
    const result = await exec("git", ["config", "--local", "--list"], {
      env,
      cwd: home,
    });
    expect(result.stdout).not.toContain("credential");
    expect(result.stdout).not.toContain("test-private-token");
  });
});
