import fs from "node:fs/promises";
import { ApiError } from "../../errors.js";
import {
  fileStatKey,
  type SkillTreeFile,
  type SkillTreeManifest,
} from "./injected-skills.js";

const CONTENT_CHUNK_BYTES = 64 * 1024;

function skillTreeChangedError(): ApiError {
  return new ApiError(404, "skill_tree_not_found", "Skill tree not found");
}

function selectRequestedFiles(
  manifest: SkillTreeManifest,
  paths: readonly string[],
): SkillTreeFile[] {
  const filesByPath = new Map(manifest.files.map((file) => [file.path, file]));
  const seen = new Set<string>();
  return paths.map((requestedPath) => {
    const file = filesByPath.get(requestedPath);
    if (file === undefined || seen.has(requestedPath)) {
      throw new ApiError(
        400,
        "invalid_request",
        `Skill tree content request has an unknown or repeated path: ${requestedPath}`,
      );
    }
    seen.add(requestedPath);
    return file;
  });
}

async function assertFileUnchanged(file: SkillTreeFile): Promise<void> {
  const stat = await fs
    .stat(file.sourcePath, { bigint: true })
    .catch(() => null);
  if (stat === null || fileStatKey(stat) !== file.statKey) {
    throw skillTreeChangedError();
  }
}

async function* readFiles(
  files: readonly SkillTreeFile[],
): AsyncGenerator<Uint8Array> {
  for (const file of files) {
    const handle = await fs.open(file.sourcePath, "r");
    try {
      if (fileStatKey(await handle.stat({ bigint: true })) !== file.statKey) {
        throw skillTreeChangedError();
      }
      for (let offset = 0; offset < file.sizeBytes;) {
        const length = Math.min(CONTENT_CHUNK_BYTES, file.sizeBytes - offset);
        const bytes = Buffer.alloc(length);
        const { bytesRead } = await handle.read(bytes, 0, length, offset);
        if (bytesRead !== length) throw skillTreeChangedError();
        offset += bytesRead;
        yield bytes;
      }
      if (fileStatKey(await handle.stat({ bigint: true })) !== file.statKey) {
        throw skillTreeChangedError();
      }
    } finally {
      await handle.close();
    }
  }
}

export async function createSkillTreeContentResponse(args: {
  manifest: SkillTreeManifest;
  paths: readonly string[];
}): Promise<Response> {
  const files = selectRequestedFiles(args.manifest, args.paths);
  await Promise.all(files.map(assertFileUnchanged));
  const iterator = readFiles(files);
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await iterator.return(undefined);
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-length": String(
        files.reduce((total, file) => total + file.sizeBytes, 0),
      ),
      "content-type": "application/octet-stream",
    },
  });
}
