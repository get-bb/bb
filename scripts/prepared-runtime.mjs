import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
} from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const runtimeOutputRoots = [
  "apps/app/dist",
  "apps/server/dist",
  "apps/server/builtin-plugins",
  "apps/host-daemon/dist",
  "packages/plugin-sdk/dist",
  "packages/plugin-sdk/bundled-types",
  "packages/templates/src/generated",
  "packages/plugin-build/src/generated",
  "apps/server/src/generated",
];

const receiptPath = "node_modules/.bb-prepared-runtime.json";
const instruction =
  "Run pnpm prepare:worktree before launching the prepared runtime.";

export function hashFiles(root, paths) {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    hash.update(`${path}\0${stat.mode & 0o777}\0`);
    hash.update(
      stat.isSymbolicLink() ? readlinkSync(absolute) : readFileSync(absolute),
    );
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function runtimeSourceFingerprint(root, env = process.env) {
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter((path) => path !== "" && existsSync(join(root, path)));
  for (const directory of [".", "apps/app"]) {
    if (!existsSync(join(root, directory))) continue;
    for (const name of readdirSync(join(root, directory))) {
      const path = join(directory, name);
      if (name.startsWith(".env") && lstatSync(join(root, path)).isFile())
        paths.push(path);
    }
  }
  paths.push("node_modules/.modules.yaml", "node_modules/.pnpm/lock.yaml");
  const buildEnv = Object.fromEntries(
    Object.entries(env)
      .filter(([name]) => name === "NODE_ENV" || name.startsWith("VITE_"))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash("sha256")
    .update(
      JSON.stringify({
        root: resolve(root),
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        buildEnv,
      }),
    )
    .update(hashFiles(root, new Set(paths)))
    .digest("hex");
}

export function runtimeOutputFingerprint(root, roots = runtimeOutputRoots) {
  const paths = [];
  function visit(path) {
    const stat = lstatSync(join(root, path));
    if (stat.isDirectory()) {
      const entries = readdirSync(join(root, path));
      if (entries.length === 0)
        throw new Error(`Empty prepared output: ${path}`);
      for (const entry of entries) visit(join(path, entry));
    } else {
      paths.push(path);
    }
  }
  for (const path of roots) visit(path);
  return hashFiles(root, paths);
}

export async function clearRuntimeOutputs(root) {
  for (const path of runtimeOutputRoots) {
    await rm(join(root, path), { recursive: true, force: true });
  }
}

export async function clearPreparedRuntime(root) {
  await rm(join(root, receiptPath), { force: true });
}

export async function sealPreparedRuntime(root, sourceFingerprint) {
  if (runtimeSourceFingerprint(root) !== sourceFingerprint) {
    throw new Error(`Sources changed during preparation. ${instruction}`);
  }
  const receipt = {
    version: 1,
    sourceFingerprint,
    outputFingerprint: runtimeOutputFingerprint(root),
  };
  const target = join(root, receiptPath);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(receipt)}\n`);
  await rename(temporary, target);
}

export async function validatePreparedRuntime(root) {
  try {
    const receipt = JSON.parse(await readFile(join(root, receiptPath), "utf8"));
    if (
      receipt === null ||
      typeof receipt !== "object" ||
      receipt.version !== 1 ||
      typeof receipt.sourceFingerprint !== "string" ||
      typeof receipt.outputFingerprint !== "string"
    ) {
      throw new Error("Invalid preparation receipt");
    }
    if (receipt.sourceFingerprint !== runtimeSourceFingerprint(root)) {
      throw new Error(
        "Prepared sources, dependencies, environment, or Node runtime changed",
      );
    }
    if (receipt.outputFingerprint !== runtimeOutputFingerprint(root)) {
      throw new Error("Prepared artifacts changed");
    }
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}. ${instruction}`,
    );
  }
}
