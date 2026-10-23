import { z } from "zod";

export const HAPTIC_KINDS = [
  "selection",
  "impact-light",
  "impact-medium",
  "impact-heavy",
  "success",
  "warning",
  "error",
] as const;

export const hapticKindSchema = z.enum(HAPTIC_KINDS);

const httpUrlSchema = z.string().refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "url must be http or https");

const sharePayloadSchema = z
  .object({
    title: z.string().max(200).optional(),
    text: z.string().max(4000).optional(),
    url: httpUrlSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.text !== undefined || value.url !== undefined,
    "A share needs text or a url",
  );

export type BridgeSharePayload = z.infer<typeof sharePayloadSchema>;

export const sharedFileMetadataSchema = z
  .object({
    fileId: z.string().uuid(),
    fileName: z.string().min(1).max(180),
    kind: z.enum(["image", "video", "file"]),
    mimeType: z.string().min(1).max(200),
    processingError: z.string().max(500).optional(),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export const sharedContentResponseSchema = z
  .object({
    alreadyAcknowledged: z.boolean().optional(),
    claimScopeKey: z.string().uuid(),
    files: z.array(sharedFileMetadataSchema).max(20),
    shareId: z.string().uuid(),
    text: z.string().max(100_000),
  })
  .strict();

export const sharedUploadStatusSchema = z
  .object({
    attachment: z
      .object({
        type: z.enum(["localFile", "localImage"]),
        path: z.string(),
        name: z.string(),
        mimeType: z.string().optional(),
        sizeBytes: z.number(),
        sourceProjectId: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    error: z.string().max(1000).optional(),
    jobId: z.string().min(1).max(500),
    status: z.enum(["queued", "uploading", "complete", "failed"]),
  })
  .strict();
export type SharedFileMetadata = z.infer<typeof sharedFileMetadataSchema>;
export type SharedContentResponse = z.infer<typeof sharedContentResponseSchema>;
export type SharedUploadStatus = z.infer<typeof sharedUploadStatusSchema>;

const bridgeRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("get-shared-content"),
      payload: z
        .object({
          projectId: z.string().min(1).max(200),
          shareId: z.string().uuid(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("acknowledge-share"),
      payload: z
        .object({
          projectId: z.string().min(1).max(200),
          shareId: z.string().uuid(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("start-shared-upload"),
      payload: z
        .object({
          fileId: z.string().uuid(),
          projectId: z.string().min(1).max(200),
          shareId: z.string().uuid(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("shared-upload-status"),
      payload: z.object({ jobId: z.string().min(1).max(500) }).strict(),
    })
    .strict(),
  z.object({ kind: z.literal("share"), payload: sharePayloadSchema }).strict(),
  z
    .object({
      kind: z.literal("clipboard-html"),
      payload: z
        .object({ text: z.string().max(100000), html: z.string().max(1000000) })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("clipboard"),
      payload: z
        .object({ text: z.string().max(100000), imageUrl: httpUrlSchema })
        .strict(),
    })
    .strict(),
]);

export const NATIVE_SCREENS = ["device-settings"] as const;
export const nativeScreenSchema = z.enum(NATIVE_SCREENS);
export type NativeScreen = z.infer<typeof nativeScreenSchema>;

export const pageToShellMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("ready"),
      path: z.string(),
      pageBridgeVersion: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("title"),
      title: z.string().max(300),
      path: z.string(),
    })
    .strict(),
  z.object({ type: z.literal("haptic"), kind: hapticKindSchema }).strict(),
  z
    .object({ type: z.literal("badge"), count: z.number().int().min(0) })
    .strict(),
  z.object({ type: z.literal("open-external"), url: httpUrlSchema }).strict(),
  z
    .object({ type: z.literal("open-native"), screen: nativeScreenSchema })
    .strict(),
  z
    .object({
      type: z.literal("request"),
      id: z.string().min(1).max(64),
      request: bridgeRequestSchema,
    })
    .strict(),
]);

export type PageToShellMessage = z.infer<typeof pageToShellMessageSchema>;

export type ParsedPageMessage =
  | { ok: true; message: PageToShellMessage }
  | { ok: false; reason: string };

export function parsePageToShellMessage(raw: unknown): ParsedPageMessage {
  if (typeof raw !== "string") {
    return { ok: false, reason: "message was not a string" };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "message was not JSON" };
  }
  const parsed = pageToShellMessageSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? "unknown" };
  }
  return { ok: true, message: parsed.data };
}
