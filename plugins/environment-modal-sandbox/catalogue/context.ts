import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { CatalogueError, hash } from "./model.js";
import { safePath } from "./dockerfile.js";
import type { Catalogue } from "./store.js";

export const chunkSchema = z
  .object({
    contextId: z.string(),
    path: z.string(),
    offset: z.number().int().nonnegative(),
    data: z
      .string()
      .max(350000)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
  })
  .strict();
export function acceptChunk(
  store: Catalogue,
  token: string,
  input: z.infer<typeof chunkSchema>,
) {
  store.db
    .transaction(() => {
      const context = store.context(input.contextId);
      const upload = z
        .object({ token_hash: z.string() })
        .parse(
          store.db
            .prepare(
              "SELECT token_hash FROM context_uploads WHERE context_id=?",
            )
            .get(context.contextId),
        );
      if (
        !timingSafeEqual(
          Buffer.from(hash(token)),
          Buffer.from(upload.token_hash),
        )
      )
        throw new CatalogueError(403, "Invalid scoped context upload token");
      if (context.uploaded || context.expiresAt <= store.now())
        throw new CatalogueError(409, "Context is sealed or expired");
      safePath(input.path);
      const file = context.manifest.files.find(
        (file) => file.path === input.path,
      );
      if (!file)
        throw new CatalogueError(400, "Archive path is not allowlisted");
      const data = Buffer.from(input.data, "base64");
      if (
        input.offset + data.length > file.bytes ||
        input.offset % (256 * 1024) !== 0 ||
        (input.offset + data.length < file.bytes && data.length !== 256 * 1024)
      )
        throw new CatalogueError(400, "Invalid archive chunk bounds");
      const previous = store.db
        .prepare(
          "SELECT data FROM context_chunks WHERE context_id=? AND path=? AND offset=?",
        )
        .get(context.contextId, input.path, input.offset);
      if (
        previous &&
        !z
          .object({ data: z.instanceof(Buffer) })
          .parse(previous)
          .data.equals(data)
      )
        throw new CatalogueError(
          409,
          "Archive chunk already has different content",
        );
      store.db
        .prepare("INSERT OR IGNORE INTO context_chunks VALUES (?,?,?,?)")
        .run(context.contextId, input.path, input.offset, data);
    })
    .immediate();
}
export function contextFiles(store: Catalogue, contextId: string) {
  const context = store.context(contextId);
  const files = new Map<string, { data: Buffer; executable: boolean }>();
  for (const file of context.manifest.files) {
    const chunks = store.db
      .prepare(
        "SELECT offset,data FROM context_chunks WHERE context_id=? AND path=? ORDER BY offset",
      )
      .all(contextId, file.path)
      .map((row) =>
        z.object({ offset: z.number(), data: z.instanceof(Buffer) }).parse(row),
      );
    let offset = 0;
    for (const chunk of chunks) {
      if (chunk.offset !== offset)
        throw new CatalogueError(
          400,
          `Archive has missing chunks: ${file.path}`,
        );
      offset += chunk.data.length;
    }
    const data = Buffer.concat(chunks.map((chunk) => chunk.data));
    if (offset !== file.bytes || hash(data) !== file.sha256)
      throw new CatalogueError(400, `Archive hash/size mismatch: ${file.path}`);
    files.set(safePath(file.path), {
      data,
      executable: file.mode === "100755",
    });
  }
  return files;
}
