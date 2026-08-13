import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { SerializeError } from "../../sync/serialize/yaml.js";
import { parseOverlayText, readOverlayFiles, serializeOverlay } from "./reader.js";
import {
  decisionFromInput,
  parseOverlay,
  proposalFromInput,
  stableKeyFor,
  TRIAGE_OVERLAY_SCHEMA,
  type DecisionInput,
  type OverlayState,
  type RemoveDecisionInput,
  type TriageDecisionV1,
  type TriageOverlayV1,
  type VendorProposalInput,
  type VendorProposalState,
  type VendorProposalV1,
} from "./schema.js";

export interface OverlayWriteResult {
  file: string;
  stableKey: string;
  beforeSha256: string | null;
  afterSha256: string;
  changedFields: string[];
  state: OverlayState;
}

export interface VendorProposalWriteResult extends Omit<OverlayWriteResult, "state"> {
  state: VendorProposalState;
  proposalId: string;
}

export class OverlayCasConflictError extends Error {
  readonly code = "OVERLAY_CAS_CONFLICT" as const;

  constructor(
    readonly file: string,
    readonly expectedSha256: string | undefined,
    readonly currentSha256: string | undefined,
  ) {
    super("Triage overlay changed concurrently. Reload the file and retry the field merge.");
    this.name = "OverlayCasConflictError";
  }
}

export const OVERLAY_LOCK_STALE_MS = 30_000;

export class OverlayLockHeldError extends Error {
  readonly code = "OVERLAY_LOCK_HELD" as const;

  constructor(readonly file: string) {
    super("Another writer currently holds this triage overlay. Retry after that write finishes.");
    this.name = "OverlayLockHeldError";
  }
}

interface ComponentCacheEntry {
  directoryMtimeMs: number | null;
  files: Map<string, string>;
}

const componentCache = new Map<string, ComponentCacheEntry>();

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function sameComponent(left: TriageOverlayV1["component"], right: TriageOverlayV1["component"]): boolean {
  return left.purl === right.purl
    && left.name === right.name
    && left.group === right.group
    && left.version === right.version;
}

function safeComponent(value: string): string {
  const slug = value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/gu, "")
    .slice(0, 80);
  return slug.length > 0 && slug !== "." && slug !== ".." ? slug : "component";
}

function componentIdentity(component: TriageOverlayV1["component"]): string {
  return JSON.stringify([component.purl, component.name, component.group, component.version]);
}

function componentCacheKey(root: string, project: string): string {
  return `${root}\0${project}`;
}

async function directoryMtime(directory: string): Promise<number | null> {
  try {
    const metadata = await lstat(directory);
    return metadata.isDirectory() ? metadata.mtimeMs : null;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

async function cachedComponentFile(
  root: string,
  project: string,
  component: TriageOverlayV1["component"],
): Promise<string | null> {
  const directory = resolve(root, ".fs", "triage", project);
  const mtime = await directoryMtime(directory);
  const cacheKey = componentCacheKey(root, project);
  let cached = componentCache.get(cacheKey);
  if (cached === undefined || cached.directoryMtimeMs !== mtime) {
    const parsed = await readOverlayFiles(root);
    cached = {
      directoryMtimeMs: mtime,
      files: new Map(parsed.files
        .filter((entry) => entry.overlay.project === project)
        .map((entry) => [componentIdentity(entry.overlay.component), entry.absoluteFile])),
    };
    componentCache.set(cacheKey, cached);
  }
  const file = cached.files.get(componentIdentity(component));
  if (file === undefined) return null;
  const current = await readCurrent(root, file);
  if (current !== null && current.overlay.project === project && sameComponent(current.overlay.component, component)) {
    return file;
  }
  componentCache.delete(cacheKey);
  return cachedComponentFile(root, project, component);
}

async function rememberComponentFile(
  root: string,
  project: string,
  component: TriageOverlayV1["component"],
  file: string | null,
): Promise<void> {
  const cacheKey = componentCacheKey(root, project);
  const cached = componentCache.get(cacheKey) ?? { directoryMtimeMs: null, files: new Map<string, string>() };
  const identity = componentIdentity(component);
  if (file === null) cached.files.delete(identity);
  else cached.files.set(identity, file);
  cached.directoryMtimeMs = await directoryMtime(resolve(root, ".fs", "triage", project));
  componentCache.set(cacheKey, cached);
}

function normalizeFile(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

async function canonicalRoot(root: string): Promise<string> {
  if (!isAbsolute(root)) throw new SerializeError(root, null, "Overlay root must be absolute");
  return realpath(root);
}

async function ensureDirectory(root: string, directory: string): Promise<void> {
  const fromRoot = relative(root, directory);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new SerializeError(directory, null, "Overlay path escapes the project root");
  let current = root;
  for (const segment of fromRoot.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new SerializeError(normalizeFile(root, current), null, "Overlay directory path contains a symlink or non-directory");
      }
    } catch (error) {
      if (!missing(error)) throw error;
      await mkdir(current, { mode: 0o755 });
    }
  }
}

async function readCurrent(root: string, file: string): Promise<{ overlay: TriageOverlayV1; text: string; digest: string } | null> {
  try {
    const metadata = await lstat(file);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new SerializeError(normalizeFile(root, file), null, "Overlay target must be a regular file, not a symlink");
    }
    const text = await readFile(file, "utf8");
    return { overlay: parseOverlayText(text, normalizeFile(root, file)), text, digest: sha256(text) };
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function candidateOverlay(input: DecisionInput): TriageOverlayV1 {
  const decision = decisionFromInput(input);
  return parseOverlay({
    schema: TRIAGE_OVERLAY_SCHEMA,
    project: input.project,
    component: input.component,
    decisions: { [input.cve]: decision },
  }, "<input>");
}

function candidateProposalOverlay(input: VendorProposalInput): TriageOverlayV1 {
  const proposal = proposalFromInput(input);
  return parseOverlay({
    schema: TRIAGE_OVERLAY_SCHEMA,
    project: input.project,
    component: input.component,
    decisions: {},
    proposals: { [input.proposalId]: proposal },
  }, "<input>");
}

async function componentFile(root: string, project: string, component: TriageOverlayV1["component"]): Promise<string> {
  const directory = resolve(root, ".fs", "triage", project);
  const base = safeComponent(component.name);
  const plain = resolve(directory, `${base}.yaml`);
  const identity = componentIdentity(component);
  const collision = resolve(directory, `${base}-${sha256(identity).slice(0, 10)}.yaml`);
  const plainCurrent = await readCurrent(root, plain);
  if (plainCurrent?.overlay.project === project && sameComponent(plainCurrent.overlay.component, component)) return plain;
  const collisionCurrent = await readCurrent(root, collision);
  if (collisionCurrent?.overlay.project === project && sameComponent(collisionCurrent.overlay.component, component)) {
    return collision;
  }
  const existing = await cachedComponentFile(root, project, component);
  if (existing !== null) return existing;
  if (plainCurrent === null) return plain;
  if (collisionCurrent === null) return collision;
  throw new SerializeError(normalizeFile(root, collision), 1, "Overlay filename collision belongs to a different component identity");
}

function flatten(value: unknown, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    result.set(prefix, JSON.stringify(value));
    return result;
  }
  for (const [key, item] of Object.entries(value)) {
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    for (const [child, encoded] of flatten(item, path)) result.set(child, encoded);
  }
  return result;
}

function changedFields(
  before: TriageDecisionV1 | VendorProposalV1 | undefined,
  after: TriageDecisionV1 | VendorProposalV1 | undefined,
): string[] {
  const left = flatten(before ?? null);
  const right = flatten(after ?? null);
  return [...new Set([...left.keys(), ...right.keys()])]
    .filter((key) => key.length > 0 && left.get(key) !== right.get(key))
    .sort();
}

function decisionState(decision: TriageDecisionV1): OverlayState {
  if (decision.sync.base === null) return "dirty";
  const tuple = {
    status: decision.status,
    justification: decision.justification,
    response: decision.response,
    reason: decision.reason,
  };
  return JSON.stringify(tuple) === JSON.stringify(decision.sync.base) ? "pushed" : "dirty";
}

async function acquireLock(root: string, file: string, attempts = 0) {
  const lock = `${file}.lock`;
  try {
    return await open(lock, "wx", 0o600);
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) {
      throw error;
    }
    let metadata;
    try {
      metadata = await lstat(lock);
    } catch (statError) {
      if (missing(statError) && attempts < 2) return acquireLock(root, file, attempts + 1);
      throw statError;
    }
    if (Date.now() - metadata.mtimeMs > OVERLAY_LOCK_STALE_MS && attempts < 2) {
      const stale = `${lock}.${process.pid}.${randomUUID()}.stale`;
      try {
        await rename(lock, stale);
      } catch (renameError) {
        if (missing(renameError)) return acquireLock(root, file, attempts + 1);
        throw renameError;
      }
      try {
        await unlink(stale);
      } catch (unlinkError) {
        if (!missing(unlinkError)) throw unlinkError;
      }
      return acquireLock(root, file, attempts + 1);
    }
    throw new OverlayLockHeldError(normalizeFile(root, file));
  }
}

async function withLock<T>(root: string, file: string, action: () => Promise<T>): Promise<T> {
  const handle = await acquireLock(root, file);
  const lock = `${file}.lock`;
  try {
    return await action();
  } finally {
    await handle.close();
    await unlink(lock).catch(() => undefined);
  }
}

async function commitFile(root: string, file: string, serialized: string, observedDigest: string | undefined): Promise<void> {
  const current = await readCurrent(root, file);
  if (current?.digest !== observedDigest) {
    throw new OverlayCasConflictError(normalizeFile(root, file), observedDigest, current?.digest);
  }
  const temporary = resolve(dirname(file), `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, serialized, { encoding: "utf8", mode: 0o644, flag: "wx" });
    const immediatelyBeforeRename = await readCurrent(root, file);
    if (immediatelyBeforeRename?.digest !== observedDigest) {
      throw new OverlayCasConflictError(normalizeFile(root, file), observedDigest, immediatelyBeforeRename?.digest);
    }
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function setDecision(root: string, input: DecisionInput, expectedSha256?: string): Promise<OverlayWriteResult> {
  const projectRoot = await canonicalRoot(root);
  const initial = candidateOverlay(input);
  const file = await componentFile(projectRoot, initial.project, initial.component);
  await ensureDirectory(projectRoot, dirname(file));
  const result = await withLock<OverlayWriteResult>(projectRoot, file, async () => {
    const current = await readCurrent(projectRoot, file);
    if (expectedSha256 !== undefined && current?.digest !== expectedSha256) {
      throw new OverlayCasConflictError(normalizeFile(projectRoot, file), expectedSha256, current?.digest);
    }
    if (current !== null && (!sameComponent(current.overlay.component, initial.component) || current.overlay.project !== initial.project)) {
      throw new SerializeError(normalizeFile(projectRoot, file), 1, "Overlay file belongs to a different component identity");
    }
    const before = current?.overlay.decisions[input.cve];
    const decision = initial.decisions[input.cve];
    if (decision === undefined) throw new Error("Validated decision is missing");
    const overlay: TriageOverlayV1 = current?.overlay ?? { ...initial, decisions: {} };
    overlay.decisions[input.cve] = decision;
    const serialized = serializeOverlay(overlay);
    const afterDigest = sha256(serialized);
    const fields = changedFields(before, decision);
    if (current?.text !== serialized) await commitFile(projectRoot, file, serialized, current?.digest);
    return {
      file: normalizeFile(projectRoot, file),
      stableKey: stableKeyFor(initial.project, initial.component, input.cve),
      beforeSha256: current?.digest ?? null,
      afterSha256: current?.text === serialized ? current.digest : afterDigest,
      changedFields: fields,
      state: decisionState(decision),
    };
  });
  await rememberComponentFile(projectRoot, initial.project, initial.component, file);
  return result;
}

/** Writes an untrusted supplier proposal through the same file lock and digest CAS as decisions. */
export async function setVendorProposal(
  root: string,
  input: VendorProposalInput,
  expectedSha256?: string,
): Promise<VendorProposalWriteResult> {
  const projectRoot = await canonicalRoot(root);
  const initial = candidateProposalOverlay(input);
  const file = await componentFile(projectRoot, initial.project, initial.component);
  await ensureDirectory(projectRoot, dirname(file));
  const result = await withLock<VendorProposalWriteResult>(projectRoot, file, async () => {
    const current = await readCurrent(projectRoot, file);
    if (expectedSha256 !== undefined && current?.digest !== expectedSha256) {
      throw new OverlayCasConflictError(normalizeFile(projectRoot, file), expectedSha256, current?.digest);
    }
    if (current !== null && (!sameComponent(current.overlay.component, initial.component) || current.overlay.project !== initial.project)) {
      throw new SerializeError(normalizeFile(projectRoot, file), 1, "Overlay file belongs to a different component identity");
    }
    const proposal = initial.proposals?.[input.proposalId];
    if (proposal === undefined) throw new Error("Validated vendor proposal is missing");
    const before: VendorProposalV1 | undefined = current?.overlay.proposals?.[input.proposalId];
    const overlay: TriageOverlayV1 = current?.overlay ?? { ...initial, decisions: {}, proposals: {} };
    const proposals = overlay.proposals ?? {};
    proposals[input.proposalId] = proposal;
    overlay.proposals = proposals;
    const serialized = serializeOverlay(overlay);
    const afterDigest = sha256(serialized);
    const fields = changedFields(before, proposal);
    if (current?.text !== serialized) await commitFile(projectRoot, file, serialized, current?.digest);
    return {
      file: normalizeFile(projectRoot, file),
      proposalId: input.proposalId,
      stableKey: proposal.target_stable_key ?? stableKeyFor(initial.project, initial.component, proposal.cve),
      beforeSha256: current?.digest ?? null,
      afterSha256: current?.text === serialized ? current.digest : afterDigest,
      changedFields: fields,
      state: proposal.state,
    };
  });
  await rememberComponentFile(projectRoot, initial.project, initial.component, file);
  return result;
}

export async function removeDecision(root: string, input: RemoveDecisionInput, expectedSha256?: string): Promise<OverlayWriteResult> {
  const projectRoot = await canonicalRoot(root);
  const stableKey = stableKeyFor(input.project, input.component, input.cve);
  if (stableKey !== input.stableKey) throw new Error("stableKey does not match the frozen finding identity codec");
  const file = await componentFile(projectRoot, input.project, input.component);
  await ensureDirectory(projectRoot, dirname(file));
  const result = await withLock<OverlayWriteResult>(projectRoot, file, async () => {
    const current = await readCurrent(projectRoot, file);
    if (current === null) throw new SerializeError(normalizeFile(projectRoot, file), null, "Overlay decision does not exist");
    if (expectedSha256 !== undefined && current.digest !== expectedSha256) {
      throw new OverlayCasConflictError(normalizeFile(projectRoot, file), expectedSha256, current.digest);
    }
    const before = current.overlay.decisions[input.cve];
    if (before === undefined) throw new SerializeError(normalizeFile(projectRoot, file), 1, "Overlay decision does not exist");
    delete current.overlay.decisions[input.cve];
    const fields = changedFields(before, undefined);
    if (Object.keys(current.overlay.decisions).length === 0 && Object.keys(current.overlay.proposals ?? {}).length === 0) {
      const immediatelyBeforeDelete = await readCurrent(projectRoot, file);
      if (immediatelyBeforeDelete?.digest !== current.digest) {
        throw new OverlayCasConflictError(normalizeFile(projectRoot, file), current.digest, immediatelyBeforeDelete?.digest);
      }
      await unlink(file);
      return {
        file: normalizeFile(projectRoot, file),
        stableKey,
        beforeSha256: current.digest,
        afterSha256: sha256(""),
        changedFields: fields,
        state: "dirty",
      };
    }
    const serialized = serializeOverlay(current.overlay);
    await commitFile(projectRoot, file, serialized, current.digest);
    return {
      file: normalizeFile(projectRoot, file),
      stableKey,
      beforeSha256: current.digest,
      afterSha256: sha256(serialized),
      changedFields: fields,
      state: "dirty",
    };
  });
  const remaining = await readCurrent(projectRoot, file);
  await rememberComponentFile(projectRoot, input.project, input.component, remaining === null ? null : file);
  return result;
}
