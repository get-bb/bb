import { z } from "zod";

export const SAVE_FILE_MAX_TRANSFER_BYTES = 50 * 1024 * 1024;

export const SAVE_FILE_CHUNK_BYTES = 384 * 1024;

export const SAVE_FILE_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

const MAX_CHUNK_BASE64_CHARS = Math.ceil(SAVE_FILE_CHUNK_BYTES / 3) * 4;

export const saveFileSupportSchema = z
  .object({
    maxTransferBytes: z.number().int().positive(),
    chunkBytes: z.number().int().positive(),
  })
  .strict();

export type SaveFileSupport = z.infer<typeof saveFileSupportSchema>;

export const SAVE_FILE_SUPPORT: SaveFileSupport = {
  maxTransferBytes: SAVE_FILE_MAX_TRANSFER_BYTES,
  chunkBytes: SAVE_FILE_CHUNK_BYTES,
};

const transferIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/u, "transferId must be a short token");

const base64Schema = z
  .string()
  .min(4)
  .max(MAX_CHUNK_BASE64_CHARS)
  .refine(
    (value) => value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/u.test(value),
    "data must be base64",
  );

export function base64DecodedLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

export const fileTransferStartPayloadSchema = z
  .object({
    size: z.number().int().nonnegative().max(SAVE_FILE_MAX_TRANSFER_BYTES),
  })
  .strict();

export const fileTransferChunkPayloadSchema = z
  .object({
    transferId: transferIdSchema,
    offset: z.number().int().nonnegative(),
    data: base64Schema,
  })
  .strict();

export function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export const saveFilePayloadSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    source: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("url"),
          url: z.string().refine(isHttpUrl, "url must be http or https"),
        })
        .strict(),
      z
        .object({ kind: z.literal("transfer"), transferId: transferIdSchema })
        .strict(),
    ]),
  })
  .strict();

export type SaveFilePayload = z.infer<typeof saveFilePayloadSchema>;

export const fileTransferStartResultSchema = z
  .object({ transferId: transferIdSchema })
  .strict();

export const fileTransferChunkResultSchema = z
  .object({ received: z.number().int().nonnegative() })
  .strict();

export const saveFileResultSchema = z
  .object({ outcome: z.enum(["saved", "dismissed"]) })
  .strict();

export type SaveFileResult = z.infer<typeof saveFileResultSchema>;
