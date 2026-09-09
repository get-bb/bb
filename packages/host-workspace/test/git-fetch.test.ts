import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRemoteBranches, runGit } from "../src/git.js";

const tempDirs: string[] = [];

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function initRepo(): Promise<string> {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "bb-git-fetch-"));
  tempDirs.push(repo);
  await runGit(["init", "-b", "main"], { cwd: repo });
  await runGit(
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "Initial commit",
    ],
    { cwd: repo },
  );
  return repo;
}

async function writeScript(repo: string, name: string, body: string) {
  const script = path.join(repo, name);
  await fs.writeFile(script, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return script;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("background Git authentication", () => {
  it("preserves a working GIT_SSH wrapper, including paths with spaces", async () => {
    const repo = await initRepo();
    const wrapper = await writeScript(
      repo,
      "ssh wrapper.sh",
      `if [ "$1" = "-G" ]; then exit 0; fi\nexec git-upload-pack ${quote(repo)}`,
    );
    vi.stubEnv("GIT_SSH_COMMAND", undefined);
    vi.stubEnv("GIT_SSH", wrapper);
    await runGit(["remote", "add", "origin", "ssh://git.invalid/repo.git"], {
      cwd: repo,
    });

    await expect(
      fetchRemoteBranches(repo, { interactive: false, timeoutMs: 2_000 }),
    ).resolves.toEqual({ status: "fetched" });
    await expect(
      runGit(["rev-parse", "origin/main"], { cwd: repo }),
    ).resolves.toMatchObject({ exitCode: 0 });
  });

  it.each(["GIT_ASKPASS", "core.askPass", "SSH_ASKPASS"])(
    "suppresses %s on HTTP authentication while preserving explicit refresh prompts",
    async (setting) => {
      const repo = await initRepo();
      const log = path.join(repo, "prompts.log");
      const askpass = await writeScript(
        repo,
        "askpass.sh",
        `printf '%s\\n' "$*" >> ${quote(log)}\nprintf '%s\\n' fixture`,
      );
      await fs.writeFile(log, "");
      vi.stubEnv("GIT_ASKPASS", undefined);
      vi.stubEnv("SSH_ASKPASS", undefined);
      if (setting === "core.askPass") {
        await runGit(["config", "core.askPass", askpass], { cwd: repo });
      } else {
        vi.stubEnv(setting, askpass);
      }
      await runGit(["config", "credential.helper", ""], { cwd: repo });
      const server = http.createServer((_request, response) => {
        response.writeHead(401, {
          "WWW-Authenticate": 'Basic realm="fixture"',
        });
        response.end();
      });
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });
      try {
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("Expected an HTTP listener address");
        }
        await runGit(
          [
            "remote",
            "add",
            "origin",
            `http://127.0.0.1:${address.port}/repo.git`,
          ],
          { cwd: repo },
        );
        await expect(
          fetchRemoteBranches(repo, { interactive: false, timeoutMs: 2_000 }),
        ).resolves.toEqual({ status: "failed" });
        expect(await fs.readFile(log, "utf8")).toBe("");

        await expect(
          fetchRemoteBranches(repo, { interactive: true, timeoutMs: 2_000 }),
        ).resolves.toEqual({ status: "failed" });
        expect(await fs.readFile(log, "utf8")).toContain("Username for");
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "kills background transport descendants when a refresh times out",
    async () => {
      const repo = await initRepo();
      const marker = path.join(repo, "late-side-effect");
      const wrapper = await writeScript(
        repo,
        "slow-ssh.sh",
        `if [ "$1" = "-G" ]; then exit 0; fi\n(sleep 0.5; touch ${quote(marker)}) &\nwait`,
      );
      await runGit(["config", "core.sshCommand", quote(wrapper)], {
        cwd: repo,
      });
      await runGit(["remote", "add", "origin", "ssh://git.invalid/repo.git"], {
        cwd: repo,
      });
      await expect(
        fetchRemoteBranches(repo, { interactive: false, timeoutMs: 200 }),
      ).resolves.toEqual({ status: "failed" });
      await new Promise((resolve) => setTimeout(resolve, 600));
      await expect(fs.access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
});
