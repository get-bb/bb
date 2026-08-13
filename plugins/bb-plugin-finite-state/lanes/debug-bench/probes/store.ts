import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

export const BENCH_ARTIFACT_DIRECTORY = ".fs-bench" as const;
export const BENCH_PROBE_RUN_DIRECTORY = "probe-runs" as const;
export const PROBE_SOURCE_DIRECTORY = ".fs/bench/probes" as const;

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const HEADER_LIMIT = 16 * 1024;
const execFileAsync = promisify(execFile);

export class ProbeStoreError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProbeStoreError";
  }
}

export interface ProbeScriptHeader {
  hypothesis: string;
  devices: string[];
  expectedObservation: string;
}

export interface ProbeScript {
  path: string;
  absolutePath: string;
  source: string;
  header: ProbeScriptHeader;
}

export interface ProbeStore {
  create(name: string, source: string): Promise<{ script: ProbeScript; changed: boolean }>;
  read(scriptPath: string): Promise<ProbeScript>;
}

function contained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

async function validateWorktreeRoot(worktreeRoot: string): Promise<string> {
  if (!isAbsolute(worktreeRoot)) {
    throw new ProbeStoreError("INVALID_WORKTREE_ROOT", "The worktree root must be absolute.");
  }
  let canonical: string;
  try {
    canonical = await realpath(worktreeRoot);
    if (!(await lstat(canonical)).isDirectory()) throw new Error("not a directory");
  } catch (error) {
    throw new ProbeStoreError("INVALID_WORKTREE_ROOT", "The worktree root must be an existing directory.", { cause: error });
  }
  let gitRoot: string;
  try {
    const result = await execFileAsync("git", ["-C", canonical, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      windowsHide: true,
    });
    gitRoot = result.stdout.trim();
  } catch (error) {
    throw new ProbeStoreError("INVALID_WORKTREE_ROOT", "Probe storage requires a Git worktree root.", { cause: error });
  }
  if (await realpath(gitRoot) !== canonical) {
    throw new ProbeStoreError("INVALID_WORKTREE_ROOT", "The supplied path is not the Git worktree root.");
  }
  return canonical;
}

export async function assertBenchArtifactRootIgnored(worktreeRoot: string): Promise<string> {
  const root = await validateWorktreeRoot(worktreeRoot);
  const artifactRoot = join(root, BENCH_ARTIFACT_DIRECTORY);
  try {
    const stat = await lstat(artifactRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new ProbeStoreError(
        "BENCH_ARTIFACT_ROOT_UNSAFE",
        `${BENCH_ARTIFACT_DIRECTORY} must be a real directory, not a symlink or file.`,
      );
    }
    const canonicalArtifactRoot = await realpath(artifactRoot);
    if (!contained(root, canonicalArtifactRoot)) {
      throw new ProbeStoreError("BENCH_ARTIFACT_ROOT_UNSAFE", "The bench artifact root escapes the worktree.");
    }
  } catch (error) {
    if (error instanceof ProbeStoreError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && error.code !== "ENOENT") throw error;
  }
  try {
    await execFileAsync(
      "git",
      ["-C", root, "check-ignore", "--quiet", "--no-index", "--", `${BENCH_ARTIFACT_DIRECTORY}/.ignore-probe`],
      { windowsHide: true },
    );
  } catch (error) {
    throw new ProbeStoreError(
      "BENCH_ARTIFACT_ROOT_NOT_IGNORED",
      `${BENCH_ARTIFACT_DIRECTORY} must be ignored before probe artifacts are written.`,
      { cause: error },
    );
  }
  return artifactRoot;
}

function validateSegment(value: string, code: string): string {
  if (!SAFE_SEGMENT.test(value) || value === "." || value === ".." || value.includes("\0")) {
    throw new ProbeStoreError(code, `${value || "<empty>"} is not a safe path segment.`);
  }
  return value;
}

export function normalizeProbeScriptPath(value: string): string {
  if (value.includes("\0") || isAbsolute(value) || value.includes("\\")) {
    throw new ProbeStoreError("INVALID_PROBE_PATH", "Probe paths must be rooted relative POSIX paths.");
  }
  const prefix = `${PROBE_SOURCE_DIRECTORY}/`;
  const name = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  if (name.includes("/") || !name.endsWith(".py")) {
    throw new ProbeStoreError("INVALID_PROBE_PATH", `Probe paths must be ${prefix}<name>.py.`);
  }
  validateSegment(name.slice(0, -3), "INVALID_PROBE_PATH");
  return `${prefix}${name}`;
}

function boundedHeaderText(name: string, value: string): string {
  const text = value.trim();
  if (text.length === 0 || text.length > 4096 || text.includes("\0")) {
    throw new ProbeStoreError("INVALID_PROBE_HEADER", `${name} must be non-empty and bounded.`);
  }
  return text;
}

export function parseProbeHeader(source: string): ProbeScriptHeader {
  const prefix = source.slice(0, HEADER_LIMIT);
  const match = /^\s*(?:#![^\n]*\n)?\s*(?:"""|''')([\s\S]*?)(?:"""|''')/u.exec(prefix);
  if (!match) throw new ProbeStoreError("INVALID_PROBE_HEADER", "Probe scripts require a structured module docstring header.");
  const fields = new Map<string, string>();
  for (const line of match[1]!.split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    fields.set(line.slice(0, separator).trim().toLocaleLowerCase("en-US"), line.slice(separator + 1).trim());
  }
  const hypothesis = boundedHeaderText("hypothesis", fields.get("hypothesis") ?? "");
  const expectedObservation = boundedHeaderText(
    "expected discriminating observation",
    fields.get("expected discriminating observation") ?? fields.get("expected") ?? "",
  );
  const devicesText = boundedHeaderText("devices", fields.get("devices") ?? "");
  const devices = devicesText.split(",").map((device) => {
    const id = device.trim();
    if (id.length === 0 || id.length > 512 || /[\u0000\r\n]/u.test(id)) {
      throw new ProbeStoreError("INVALID_PROBE_HEADER", "Probe header device ids must be non-empty and bounded.");
    }
    return id;
  });
  if (new Set(devices).size !== devices.length) {
    throw new ProbeStoreError("INVALID_PROBE_HEADER", "Probe header devices must be unique.");
  }
  return { hypothesis, devices, expectedObservation };
}

async function assertNoSymlinkPath(root: string, relativePath: string): Promise<void> {
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw new ProbeStoreError("UNSAFE_PROBE_PATH", "Probe paths may not traverse symlinks.");
      }
    } catch (error) {
      if (error instanceof ProbeStoreError) throw error;
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
  }
}

async function assertRealContainedDirectory(root: string, directory: string): Promise<void> {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ProbeStoreError("UNSAFE_PROBE_PATH", "Probe artifact directories must be real directories.");
  }
  if (!contained(root, await realpath(directory))) {
    throw new ProbeStoreError("UNSAFE_PROBE_PATH", "Probe artifact directory escapes its root.");
  }
}

export async function openProbeStore(worktreeRoot: string): Promise<ProbeStore> {
  const root = await validateWorktreeRoot(worktreeRoot);
  const sourceRoot = join(root, PROBE_SOURCE_DIRECTORY);
  return {
    async create(name, source) {
      const scriptPath = normalizeProbeScriptPath(name.endsWith(".py") ? name : `${name}.py`);
      const header = parseProbeHeader(source);
      await assertNoSymlinkPath(root, PROBE_SOURCE_DIRECTORY);
      await mkdir(sourceRoot, { recursive: true });
      await assertNoSymlinkPath(root, scriptPath);
      const absolutePath = join(root, scriptPath);
      try {
        const existing = await readFile(absolutePath, "utf8");
        if (existing === source) return { script: { path: scriptPath, absolutePath, source, header }, changed: false };
        if ((await lstat(absolutePath)).isSymbolicLink()) throw new ProbeStoreError("UNSAFE_PROBE_PATH", "Probe scripts may not be symlinks.");
      } catch (error) {
        if (error instanceof ProbeStoreError) throw error;
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
      }
      const temporary = join(sourceRoot, `.${randomUUID()}.tmp`);
      await writeFile(temporary, source, { encoding: "utf8", mode: 0o644, flag: "wx" });
      await rename(temporary, absolutePath);
      return { script: { path: scriptPath, absolutePath, source, header }, changed: true };
    },
    async read(input) {
      const path = normalizeProbeScriptPath(input);
      await assertNoSymlinkPath(root, path);
      const absolutePath = join(root, path);
      const stat = await lstat(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new ProbeStoreError("UNSAFE_PROBE_PATH", "Probe scripts must be regular files.");
      await access(absolutePath, constants.R_OK);
      const source = await readFile(absolutePath, "utf8");
      return { path, absolutePath, source, header: parseProbeHeader(source) };
    },
  };
}

function normalizeArtifactPath(value: string): string {
  if (value.includes("\0") || isAbsolute(value) || value.includes("\\")) {
    throw new ProbeStoreError("INVALID_ARTIFACT_PATH", "Artifact paths must be safe relative paths.");
  }
  const segments = value.split("/");
  if (segments.length < 1 || segments.some((segment) => !SAFE_SEGMENT.test(segment) || segment === "." || segment === "..")) {
    throw new ProbeStoreError("INVALID_ARTIFACT_PATH", "Artifact paths contain an unsafe segment.");
  }
  return segments.join("/");
}

export interface ProbeRunArtifactDirectory {
  worktreeRoot: string;
  artifactRoot: string;
  runRoot: string;
  directory: string;
  relativeDirectory: string;
}

export async function ensureProbeRunArtifactDirectory(
  worktreeRoot: string,
  runId: string,
  subdirectory: string | null = null,
): Promise<ProbeRunArtifactDirectory> {
  validateSegment(runId, "INVALID_RUN_ID");
  const relativeSubdirectory = subdirectory === null ? null : normalizeArtifactPath(subdirectory);
  const canonicalWorktree = await realpath(worktreeRoot);
  const artifactRoot = await assertBenchArtifactRootIgnored(canonicalWorktree);
  await mkdir(artifactRoot, { recursive: true });
  await assertRealContainedDirectory(canonicalWorktree, artifactRoot);
  const relativeRunRoot = `${BENCH_PROBE_RUN_DIRECTORY}/${runId}`;
  await assertNoSymlinkPath(artifactRoot, relativeRunRoot);
  const runRoot = join(artifactRoot, BENCH_PROBE_RUN_DIRECTORY, runId);
  await mkdir(runRoot, { recursive: true });
  await assertRealContainedDirectory(artifactRoot, join(artifactRoot, BENCH_PROBE_RUN_DIRECTORY));
  await assertRealContainedDirectory(artifactRoot, runRoot);
  if (relativeSubdirectory !== null) {
    await assertNoSymlinkPath(runRoot, relativeSubdirectory);
    await mkdir(join(runRoot, ...relativeSubdirectory.split("/")), { recursive: true });
    await assertRealContainedDirectory(runRoot, join(runRoot, ...relativeSubdirectory.split("/")));
  }
  const directory = relativeSubdirectory === null
    ? runRoot
    : join(runRoot, ...relativeSubdirectory.split("/"));
  const relativeDirectory = [BENCH_ARTIFACT_DIRECTORY, BENCH_PROBE_RUN_DIRECTORY, runId, relativeSubdirectory]
    .filter((segment): segment is string => segment !== null)
    .join("/");
  return { worktreeRoot: canonicalWorktree, artifactRoot, runRoot, directory, relativeDirectory };
}

export async function writeBenchArtifact(
  worktreeRoot: string,
  runId: string,
  artifactPath: string,
  bytes: Uint8Array,
): Promise<string> {
  const relativeArtifact = normalizeArtifactPath(artifactPath);
  const parentSegments = relativeArtifact.split("/").slice(0, -1).join("/");
  const layout = await ensureProbeRunArtifactDirectory(worktreeRoot, runId, parentSegments || null);
  await assertNoSymlinkPath(layout.runRoot, relativeArtifact);
  const destination = join(layout.runRoot, ...relativeArtifact.split("/"));
  await writeFile(destination, bytes, { mode: 0o600, flag: "wx" });
  return `${BENCH_ARTIFACT_DIRECTORY}/${BENCH_PROBE_RUN_DIRECTORY}/${runId}/${relativeArtifact}`;
}
