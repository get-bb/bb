import { spawn } from "node:child_process";
import { isLockfile } from "./catalogue/source-contract.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, lstat, realpath } from "node:fs/promises";
import { resolve, relative, matchesGlob } from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { sourceContract } from "./catalogue/source-contract.js";
import { CatalogueError, hash, type Manifest } from "./catalogue/model.js";
import { safePath } from "./catalogue/dockerfile.js";

const exec = promisify(execFile);
async function git(path: string, args: string[]) {
  return (
    await exec("git", ["-C", path, ...args], {
      encoding: "buffer",
      maxBuffer: 256 * 1024 * 1024,
    })
  ).stdout;
}
const split = (buffer: Buffer) =>
  buffer.toString("utf8").split("\0").filter(Boolean);
const forbidden =
  /(^|\/)(?:\.git|\.env[^/]*|node_modules|\.cache|\.ssh|\.aws|\.config|\.npmrc|\.pypirc|credentials[^/]*)(\/|$)|\.(?:pem|key|p12)$/i;

const evidence =
  /(^|\/)(?:AGENTS\.md|package\.json|.*lock.*|.*\.toml|.*\.mod|.*\.sum|\.nvmrc|\.node-version|Dockerfile[^/]*|\.bb-env-setup\.sh|\.bb-env-teardown\.sh|\.worktreeinclude|.*\.ya?ml)$/;
export async function inspectSource(path: string, hostId: string) {
  const commit = (await git(path, ["rev-parse", "HEAD"])).toString().trim();
  const dirty = split(await git(path, ["diff", "HEAD", "--name-only", "-z"]));
  const untracked = split(
    await git(path, ["ls-files", "--others", "--exclude-standard", "-z"]),
  );
  const tracked = split(await git(path, ["ls-files", "-z"]));
  const stage = (await git(path, ["ls-files", "--stage"])).toString();
  const submodules = stage
    .split("\n")
    .filter((line) => line.startsWith("160000 "))
    .map((line) => line.split("\t")[1]!);
  const facts = [];
  const lfs = [];
  for (const name of tracked.filter(
    (name) => evidence.test(name) && !forbidden.test(name),
  )) {
    const data = await workingFile(path, name).catch(() => null);
    if (!data) continue;
    if (
      data.data
        .subarray(0, 100)
        .toString()
        .startsWith("version https://git-lfs.github.com/spec/")
    )
      lfs.push(name);
    facts.push({
      path: name,
      sha256: hash(data.data),
      bytes: data.data.length,
      mode: data.executable ? ("100755" as const) : ("100644" as const),
      kind: isLockfile(name) ? "lockfile" : "setup",
    });
  }
  return {
    source: {
      hostId,
      path,
      commit,
      dirty: [...new Set([...dirty, ...untracked])].sort(),
      submodules,
      lfs,
    },
    evidence: facts,
    setupHooks: tracked.filter((name) =>
      [".bb-env-setup.sh", ".bb-env-teardown.sh", ".worktreeinclude"].includes(
        name,
      ),
    ),
    missing: facts.some((file) => file.kind === "lockfile")
      ? []
      : ["No lockfile found"],
  };
}
async function workingFile(root: string, name: string) {
  safePath(name);
  const path = resolve(root, name);
  const stat = await lstat(path);
  const rel = relative(await realpath(root), await realpath(path));
  if (rel.startsWith("..") || !stat.isFile() || stat.isSymbolicLink())
    throw new CatalogueError(
      400,
      `Context accepts regular files inside the checkout only: ${name}`,
    );
  return { data: await readFile(path), executable: Boolean(stat.mode & 0o111) };
}
async function content(path: string, manifest: Manifest, name: string) {
  const file = manifest.files.find((entry) => entry.path === name);
  if (!file) throw new CatalogueError(400, "File is not in reviewed manifest");
  const data = manifest.reviewedDirty.includes(name)
    ? (await workingFile(path, name)).data
    : await git(path, ["show", `${manifest.source.commit}:${name}`]);
  if (data.length !== file.bytes || hash(data) !== file.sha256)
    throw new CatalogueError(409, `Context changed since review: ${name}`);
  return data;
}
export default experimental_defineHostEntry({
  contract: sourceContract,
  handlers: {
    inspect({ path, hostId }) {
      return inspectSource(path, hostId);
    },
    async manifest(input) {
      const inspection = await inspectSource(input.path, input.hostId);
      const dirty = inspection.source.dirty;
      if (
        JSON.stringify([...input.reviewedDirty].sort()) !==
        JSON.stringify(dirty)
      )
        throw new CatalogueError(
          409,
          `Review the dirty overlay explicitly: ${JSON.stringify(dirty)}`,
        );
      if (inspection.source.submodules.length || inspection.source.lfs.length)
        throw new CatalogueError(
          400,
          "Submodules and LFS require explicit exported regular-file contexts; unsupported in v1",
        );
      const tracked = split(
        await git(input.path, [
          "ls-tree",
          "-r",
          "--name-only",
          "-z",
          inspection.source.commit,
        ]),
      );
      const secretRules = (
        await readFile(resolve(input.path, ".worktreeinclude"), "utf8").catch(
          () => "",
        )
      )
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      const names = [...new Set([...tracked, ...dirty])]
        .filter(
          (name) =>
            input.include.some((rule) => matchesGlob(name, rule)) &&
            ![...input.exclude, ...secretRules].some((rule) =>
              matchesGlob(name, rule),
            ) &&
            !forbidden.test(name),
        )
        .sort();
      const manifest: Manifest = {
        source: inspection.source,
        files: [],
        reviewedDirty: input.reviewedDirty,
        recipeId: input.recipeId,
        revision: input.revision,
      };
      for (const name of names) {
        safePath(name);
        const staged = (
          await git(input.path, [
            "ls-tree",
            inspection.source.commit,
            "--",
            name,
          ])
        ).toString();
        if (staged && !/^100(?:644|755) blob /.test(staged))
          throw new CatalogueError(400, `Unsupported archive entry ${name}`);
        const value = dirty.includes(name)
          ? await workingFile(input.path, name)
          : {
              data: await git(input.path, [
                "show",
                `${inspection.source.commit}:${name}`,
              ]),
              executable: staged.startsWith("100755"),
            };
        if (
          /-----BEGIN .*PRIVATE KEY-----|(?:sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})/.test(
            value.data.toString("utf8"),
          )
        )
          throw new CatalogueError(
            400,
            `Credential-like content excluded: ${name}`,
          );
        manifest.files.push({
          path: name,
          sha256: hash(value.data),
          bytes: value.data.length,
          mode: value.executable ? "100755" : "100644",
        });
      }
      if (
        manifest.files.reduce((sum, file) => sum + file.bytes, 0) >
        256 * 1024 * 1024
      )
        throw new CatalogueError(413, "Context exceeds 256 MiB");
      return manifest;
    },
    async smoke({ path, commands, timeoutMs, expectedCommit }) {
      const commit = (await git(path, ["rev-parse", "HEAD"]))
        .toString("utf8")
        .trim();
      if (commit !== expectedCommit)
        throw new Error(
          "Verification checkout does not match the recorded build commit",
        );
      const results = [];
      for (const command of commands) {
        const exitCode = await new Promise<number>((resolve, reject) => {
          const child = spawn("sh", ["-eu", "-c", command], {
            cwd: path,
            stdio: "ignore",
            timeout: timeoutMs,
          });
          child.once("error", reject);
          child.once("exit", (code) => resolve(code ?? 1));
        });
        results.push({ command, exitCode });
      }
      return { commit, results };
    },
    async upload({ path, manifest, url, token, contextId }) {
      for (const file of manifest.files) {
        const data = await content(path, manifest, file.path);
        for (
          let offset = 0;
          offset < Math.max(data.length, 1);
          offset += 256 * 1024
        ) {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              contextId,
              path: file.path,
              offset,
              data: data
                .subarray(offset, offset + 256 * 1024)
                .toString("base64"),
            }),
          });
          if (!response.ok)
            throw new CatalogueError(
              response.status,
              `Context upload failed: ${await response.text()}`,
            );
        }
      }
      return { uploaded: true };
    },
  },
});
