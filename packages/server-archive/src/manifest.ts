import { z } from "zod";
import { ServerArchiveError } from "./errors.js";
import {
  findRelativePathConflict,
  safeRelativePathSchema,
} from "./relative-path.js";

export const SERVER_ARCHIVE_FORMAT = "bb-server-archive";
export const SERVER_ARCHIVE_VERSION = 1;
export const SERVER_ARCHIVE_MANIFEST_PATH = "manifest.json";
export const SERVER_ARCHIVE_FILES_DIR_NAME = "files";

export const serverArchiveManifestEntrySchema = z
  .object({
    path: safeRelativePathSchema,
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();
export type ServerArchiveManifestEntry = z.infer<
  typeof serverArchiveManifestEntrySchema
>;

export const serverArchiveManifestSchema = z
  .object({
    format: z.literal(SERVER_ARCHIVE_FORMAT),
    version: z.literal(SERVER_ARCHIVE_VERSION),
    createdAt: z.number().int().nonnegative(),
    bbVersion: z.string().min(1),
    protocolVersion: z.number().int().nonnegative(),
    migrationCount: z.number().int().nonnegative(),
    sourceDataDir: z.string().min(1),
    sourceServerHostId: z.string().min(1).nullable(),
    entries: z.array(serverArchiveManifestEntrySchema),
  })
  .strict()
  .superRefine((manifest, context) => {
    const conflict = findRelativePathConflict(
      manifest.entries.map((entry) => entry.path),
    );
    if (conflict !== null) {
      context.addIssue({
        code: "custom",
        message: `Archive path ${conflict} conflicts with another entry`,
        path: ["entries"],
      });
    }
  });
export type ServerArchiveManifest = z.infer<typeof serverArchiveManifestSchema>;

export type ServerArchiveManifestInput = Omit<
  ServerArchiveManifest,
  "entries" | "format" | "version"
>;

const manifestVersionProbeSchema = z.object({
  format: z.literal(SERVER_ARCHIVE_FORMAT),
  version: z.number(),
});

export function parseServerArchiveManifest(
  value: unknown,
): ServerArchiveManifest {
  const probe = manifestVersionProbeSchema.safeParse(value);
  if (!probe.success) {
    throw new ServerArchiveError(
      "corrupt",
      "Archive manifest is not a bb server archive manifest",
    );
  }
  if (probe.data.version !== SERVER_ARCHIVE_VERSION) {
    throw new ServerArchiveError(
      "unsupported_version",
      `Unsupported bb server archive version ${String(probe.data.version)}`,
    );
  }
  const parsed = serverArchiveManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new ServerArchiveError(
      "corrupt",
      `Archive manifest is invalid: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
