import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { emitYaml, parseYaml, SerializeError } from "../../sync/serialize/yaml.js";
import {
  MAX_OVERLAY_BYTES,
  parseOverlay,
  stableKeyFor,
  type TriageOverlayV1,
} from "./schema.js";

export interface OverlayParseError {
  file: string;
  line: number | null;
  message: string;
}

export interface ParsedOverlayFile {
  file: string;
  absoluteFile: string;
  overlay: TriageOverlayV1;
  sha256: string;
}

function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function normalized(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

export function serializeOverlay(overlay: TriageOverlayV1): string {
  const parsed = parseOverlay(overlay, "<serialize>");
  return emitYaml({
    schema: parsed.schema,
    project: parsed.project,
    component: parsed.component,
    decisions: parsed.decisions,
  });
}

export function parseOverlayText(text: string, file: string): TriageOverlayV1 {
  if (Buffer.byteLength(text, "utf8") > MAX_OVERLAY_BYTES) {
    throw new SerializeError(file, null, `Overlay exceeds the ${MAX_OVERLAY_BYTES} byte limit`);
  }
  return parseOverlay(parseYaml(text, file), file);
}

async function canonicalRoot(root: string): Promise<string> {
  if (!isAbsolute(root)) throw new SerializeError(root, null, "Overlay root must be absolute");
  return realpath(root);
}

async function overlayFiles(root: string): Promise<{ files: string[]; projects: string[] }> {
  const triage = resolve(root, ".fs", "triage");
  let entries;
  try {
    entries = await readdir(triage, { withFileTypes: true });
  } catch (error) {
    if (missing(error)) return { files: [], projects: [] };
    throw error;
  }
  const files: string[] = [];
  const projects: string[] = [];
  for (const project of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (project.isSymbolicLink()) {
      files.push(resolve(triage, project.name));
      continue;
    }
    if (!project.isDirectory()) continue;
    projects.push(project.name);
    const directory = resolve(triage, project.name);
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === "policy.yaml" || entry.name === "policy.yml") continue;
      if (!entry.name.endsWith(".yaml") && !entry.name.endsWith(".yml")) continue;
      files.push(resolve(directory, entry.name));
    }
  }
  return { files, projects };
}

async function parseFile(root: string, absoluteFile: string): Promise<ParsedOverlayFile> {
  const file = normalized(root, absoluteFile);
  const metadata = await lstat(absoluteFile);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new SerializeError(file, null, "Overlay path must be a regular file, not a symlink");
  }
  if (metadata.size > MAX_OVERLAY_BYTES) {
    throw new SerializeError(file, null, `Overlay exceeds the ${MAX_OVERLAY_BYTES} byte limit`);
  }
  const canonical = await realpath(absoluteFile);
  if (!canonical.startsWith(`${root}${sep}`)) {
    throw new SerializeError(file, null, "Overlay symlink escapes the project root");
  }
  const text = await readFile(absoluteFile, "utf8");
  const overlay = parseOverlayText(text, file);
  const directoryProject = file.split("/")[2];
  if (directoryProject !== overlay.project) {
    throw new SerializeError(file, 1, "Overlay project must match its .fs/triage directory");
  }
  return { file, absoluteFile, overlay, sha256: createHash("sha256").update(text).digest("hex") };
}

export async function readOverlayFiles(root: string): Promise<{
  files: ParsedOverlayFile[];
  projects: string[];
  errors: OverlayParseError[];
}> {
  const projectRoot = await canonicalRoot(root);
  const files: ParsedOverlayFile[] = [];
  const errors: OverlayParseError[] = [];
  const discovered = await overlayFiles(projectRoot);
  for (const absoluteFile of discovered.files) {
    try {
      files.push(await parseFile(projectRoot, absoluteFile));
    } catch (error) {
      if (!(error instanceof SerializeError)) throw error;
      errors.push({ file: error.file, line: error.line, message: error.message });
    }
  }
  const accepted: ParsedOverlayFile[] = [];
  const stableKeys = new Map<string, string>();
  for (const parsed of files) {
    const duplicate = Object.keys(parsed.overlay.decisions)
      .map((cve) => `${parsed.overlay.project}\0${stableKeyFor(parsed.overlay.project, parsed.overlay.component, cve)}`)
      .find((key) => stableKeys.has(key));
    if (duplicate !== undefined) {
      errors.push({
        file: parsed.file,
        line: 1,
        message: `Decision stable key is already authored in ${stableKeys.get(duplicate)}`,
      });
      continue;
    }
    accepted.push(parsed);
    for (const cve of Object.keys(parsed.overlay.decisions)) {
      const scopedKey = `${parsed.overlay.project}\0${stableKeyFor(parsed.overlay.project, parsed.overlay.component, cve)}`;
      stableKeys.set(scopedKey, parsed.file);
    }
  }
  return { files: accepted, projects: discovered.projects, errors };
}
