import { cp, mkdir, mkdtemp, readFile, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type BuildOptions } from "esbuild";

const REPOSITORY = fileURLToPath(new URL("../../..", import.meta.url));
const DOCKERFILE = fileURLToPath(new URL("../Dockerfile", import.meta.url));

interface BuildStage {
  packages: string[];
  copies: Array<{ from: string; to: string }>;
  esbuild: string[];
}

function instructions(dockerfile: string): string[] {
  return dockerfile
    .replace(/\\\n/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

function buildStage(dockerfile: string): BuildStage {
  const stage: BuildStage = { packages: [], copies: [], esbuild: [] };
  let inBuild = false;
  for (const line of instructions(dockerfile)) {
    const [instruction = "", ...args] = line.split(/\s+/);
    if (instruction === "FROM") {
      inBuild = args.includes("build");
      continue;
    }
    if (!inBuild) continue;
    if (instruction === "COPY") {
      const [from, to] = args;
      if (from === undefined || to === undefined || args.length !== 2) {
        throw new Error(`unexpected build-stage COPY: ${line}`);
      }
      stage.copies.push({ from, to });
    } else if (instruction === "RUN" && args[0] === "npm") {
      stage.packages = args
        .slice(2)
        .filter((arg) => !arg.startsWith("-"))
        .map((spec) => spec.slice(0, spec.lastIndexOf("@")));
    } else if (instruction === "RUN" && args[1] === "esbuild") {
      stage.esbuild = args.slice(2);
    }
  }
  if (stage.copies.length === 0 || stage.esbuild.length === 0) {
    throw new Error("could not find the gate build stage in the Dockerfile");
  }
  return stage;
}

function esbuildOptions(args: string[], workDir: string): BuildOptions {
  const options: BuildOptions = {
    absWorkingDir: workDir,
    nodePaths: [],
    logLevel: "silent",
    alias: {},
  };
  for (const arg of args) {
    const [flag = "", value] = arg.split(/=(.*)/s, 2);
    if (!flag.startsWith("--")) {
      options.entryPoints = [arg];
    } else if (flag === "--bundle") {
      options.bundle = true;
    } else if (flag === "--platform" && value === "node") {
      options.platform = value;
    } else if (flag === "--format" && value === "esm") {
      options.format = value;
    } else if (flag === "--target" && value !== undefined) {
      options.target = value;
    } else if (flag === "--outfile" && value !== undefined) {
      options.outfile = value;
    } else if (flag.startsWith("--alias:") && value !== undefined) {
      options.alias = { ...options.alias, [flag.slice(8)]: value };
    } else {
      throw new Error(`unexpected esbuild flag in the Dockerfile: ${arg}`);
    }
  }
  return options;
}

function packageRoot(name: string): string {
  const require = createRequire(join(REPOSITORY, "packages/connect-db/"));
  const entry = require.resolve(name);
  const marker = `${sep}node_modules${sep}${name}${sep}`;
  return entry.slice(0, entry.lastIndexOf(marker) + marker.length - 1);
}

export async function buildGateLikeDockerfile(): Promise<string> {
  const stage = buildStage(await readFile(DOCKERFILE, "utf8"));
  const workDir = await mkdtemp(join(tmpdir(), "bb-gate-image-"));
  for (const { from, to } of stage.copies) {
    await cp(join(REPOSITORY, from), join(workDir, to), { recursive: true });
  }
  for (const name of stage.packages.filter((name) => name !== "esbuild")) {
    const link = join(workDir, "node_modules", name);
    await mkdir(dirname(link), { recursive: true });
    await symlink(packageRoot(name), link, "dir");
  }
  const options = esbuildOptions(stage.esbuild, workDir);
  await build(options);
  return join(workDir, options.outfile ?? "");
}
