import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { BROWSER_AUTOMATION_MAX_SCREENSHOT_BYTES } from "@bb/domain";
import { browserScreenshotArtifactSchema, type BrowserScreenshotArtifact } from "@bb/server-contract";
import { z } from "zod";
import { ApiError } from "../../errors.js";

export const BROWSER_SCREENSHOT_MAX_COUNT_PER_THREAD = 20;
export const BROWSER_SCREENSHOT_MAX_TOTAL_BYTES_PER_THREAD = 100 * 1024 * 1024;
const ARTIFACT_ROOT_NAME = "browser-artifacts";
const METADATA_SUFFIX = ".json";
const PNG_SUFFIX = ".png";
const TEMPORARY_SUFFIX = ".tmp";
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const browserArtifactRecordSchema = browserScreenshotArtifactSchema.extend({
  fileName: z.string().min(1).max(128),
}).strict();
type BrowserArtifactRecord = z.infer<typeof browserArtifactRecordSchema>;

interface BrowserArtifactStoreOptions {
  renameFile?: typeof rename;
}

function artifactError(): ApiError {
  return new ApiError(404, "browser_artifact_not_found", "Browser screenshot artifact not found for this thread");
}

function threadDirectory(dataDir: string, threadId: string): string {
  const directoryId = createHash("sha256").update(threadId).digest("hex");
  return join(dataDir, ARTIFACT_ROOT_NAME, directoryId);
}

function containedFile(root: string, fileName: string): string {
  if (basename(fileName) !== fileName) throw artifactError();
  const path = resolve(root, fileName);
  if (!path.startsWith(`${resolve(root)}${sep}`)) throw artifactError();
  return path;
}

async function parseRecord(root: string, metadataName: string): Promise<BrowserArtifactRecord | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(containedFile(root, metadataName), "utf8"));
    const record = browserArtifactRecordSchema.safeParse(parsed);
    return record.success ? record.data : null;
  } catch {
    return null;
  }
}

async function readRecords(root: string): Promise<BrowserArtifactRecord[]> {
  const entries = await readdir(root).catch(() => []);
  const records: BrowserArtifactRecord[] = [];
  for (const entry of entries.filter((name) => name.endsWith(METADATA_SUFFIX) && !name.includes(TEMPORARY_SUFFIX))) {
    const record = await parseRecord(root, entry);
    if (record !== null) records.push(record);
  }
  return records.sort((left, right) => left.createdAt - right.createdAt || left.artifactId.localeCompare(right.artifactId));
}

function publicMetadata(record: BrowserArtifactRecord): BrowserScreenshotArtifact {
  const { fileName: _fileName, ...metadata } = record;
  return metadata;
}

export class BrowserArtifactStore {
  private readonly renameFile: typeof rename;
  private storeTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly dataDir: string,
    private readonly now: () => number = Date.now,
    options: BrowserArtifactStoreOptions = {},
  ) {
    this.renameFile = options.renameFile ?? rename;
  }

  async store(args: { base64: string; targetId: string; threadId: string }): Promise<BrowserScreenshotArtifact> {
    return this.withLock(() => this.storeExclusive(args));
  }

  private async storeExclusive(args: { base64: string; targetId: string; threadId: string }): Promise<BrowserScreenshotArtifact> {
    const content = Buffer.from(args.base64, "base64");
    if (content.byteLength === 0 || content.byteLength > BROWSER_AUTOMATION_MAX_SCREENSHOT_BYTES || !content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new ApiError(400, "invalid_request", "Browser screenshot is not a valid bounded PNG");
    }
    const root = threadDirectory(this.dataDir, args.threadId);
    await mkdir(root, { recursive: true });
    await this.reconcile(root, args.threadId);
    const artifactId = `bs_${randomUUID()}`;
    const fileName = `${artifactId}${PNG_SUFFIX}`;
    const record: BrowserArtifactRecord = {
      artifactId,
      byteSize: content.byteLength,
      createdAt: this.now(),
      fileName,
      mimeType: "image/png",
      targetId: args.targetId,
      threadId: args.threadId,
    };
    const temporary = containedFile(root, `.${artifactId}.${randomUUID()}${TEMPORARY_SUFFIX}`);
    const destination = containedFile(root, fileName);
    const metadataTemporary = `${temporary}${METADATA_SUFFIX}`;
    const metadataDestination = containedFile(root, `${artifactId}${METADATA_SUFFIX}`);
    const paths = [temporary, metadataTemporary, destination, metadataDestination];
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.renameFile(temporary, destination);
      const metadataHandle = await open(metadataTemporary, "wx", 0o600);
      try {
        await metadataHandle.writeFile(JSON.stringify(record));
        await metadataHandle.sync();
      } finally {
        await metadataHandle.close();
      }
      await this.renameFile(metadataTemporary, metadataDestination);
      await this.enforceRetention(root, args.threadId);
      return publicMetadata(record);
    } catch (error) {
      await Promise.all(paths.map((path) => rm(path, { force: true }).catch(() => undefined)));
      throw error;
    }
  }

  async metadata(args: { artifactId: string; threadId: string }): Promise<BrowserScreenshotArtifact> {
    return this.withLock(async () => publicMetadata(await this.requireRecord(args)));
  }

  async read(args: { artifactId: string; threadId: string }): Promise<Uint8Array> {
    return this.withLock(async () => {
      const record = await this.requireRecord(args);
      const content = await readFile(containedFile(threadDirectory(this.dataDir, args.threadId), record.fileName)).catch(() => null);
      if (content === null || content.byteLength !== record.byteSize) throw artifactError();
      return content;
    });
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.storeTail;
    let release = () => {};
    this.storeTail = new Promise<void>((resolveTail) => {
      release = resolveTail;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async requireRecord(args: { artifactId: string; threadId: string }): Promise<BrowserArtifactRecord> {
    const root = threadDirectory(this.dataDir, args.threadId);
    await this.reconcile(root, args.threadId);
    const records = await readRecords(root);
    const record = records.find((candidate) => candidate.artifactId === args.artifactId && candidate.threadId === args.threadId);
    if (record === undefined || !(await stat(containedFile(root, record.fileName)).catch(() => null))?.isFile()) throw artifactError();
    return record;
  }

  private async reconcile(root: string, threadId: string): Promise<void> {
    const entries = await readdir(root).catch(() => []);
    await Promise.all(entries.filter((name) => name.includes(TEMPORARY_SUFFIX)).map((name) => rm(containedFile(root, name), { force: true })));
    const remaining = (await readdir(root).catch(() => [])).filter((name) => !name.includes(TEMPORARY_SUFFIX));
    const pairedPngs = new Set<string>();
    for (const metadataName of remaining.filter((name) => name.endsWith(METADATA_SUFFIX))) {
      const record = await parseRecord(root, metadataName);
      const expectedMetadataName = record === null ? null : `${record.artifactId}${METADATA_SUFFIX}`;
      const pngStat = record === null || record.fileName !== `${record.artifactId}${PNG_SUFFIX}`
        ? null
        : await stat(containedFile(root, record.fileName)).catch(() => null);
      const validPair = record !== null &&
        record.threadId === threadId &&
        metadataName === expectedMetadataName &&
        record.fileName === `${record.artifactId}${PNG_SUFFIX}` &&
        remaining.includes(record.fileName) &&
        pngStat?.isFile() === true &&
        pngStat.size === record.byteSize;
      if (validPair && record !== null) {
        pairedPngs.add(record.fileName);
      } else {
        await rm(containedFile(root, metadataName), { force: true });
      }
    }
    await Promise.all(remaining
      .filter((name) => name.endsWith(PNG_SUFFIX) && !pairedPngs.has(name))
      .map((name) => rm(containedFile(root, name), { force: true })));
  }

  private async enforceRetention(root: string, threadId: string): Promise<void> {
    await this.reconcile(root, threadId);
    const records = await readRecords(root);
    let totalBytes = records.reduce((sum, record) => sum + record.byteSize, 0);
    while (records.length > BROWSER_SCREENSHOT_MAX_COUNT_PER_THREAD || totalBytes > BROWSER_SCREENSHOT_MAX_TOTAL_BYTES_PER_THREAD) {
      const record = records.shift();
      if (record === undefined) break;
      await rm(containedFile(root, record.fileName), { force: true });
      await rm(containedFile(root, `${record.artifactId}${METADATA_SUFFIX}`), { force: true });
      totalBytes -= record.byteSize;
    }
  }
}
